/** M4-D break-it pass (tasks.md checklist) for monitoring, realtime and history. */
import { afterEach, describe, expect, it } from 'vitest';
import type { Prober, ProbeResult } from '../src/application/ports';
import { SimulatedNetwork } from '../src/adapters/simulated-network';
import { seedDemo } from '../src/application/demo/demo-seed';
import { SqliteDemoRepo } from '../src/db/repositories/demo-repo';
import { SqliteSchedulerRepo } from '../src/db/repositories/scheduler-repo';
import { SqliteJobsRepo } from '../src/db/repositories/jobs-repo';
import { SqliteMonitorRepo } from '../src/db/repositories/monitor-repo';
import { createServices, type Services } from '../src/services';
import { FakeClock, flushMicrotasks } from './fakes/fake-clock';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0, testDb } from './helpers/db';
import { fakePorts, type FakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const DEAD: ProbeResult = { alive: false, via: null, latencyMs: null };

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function world(prober?: (ports: FakePorts) => Prober) {
  const db = testDb();
  const clock = new FakeClock(T0);
  const ports = fakePorts(clock);
  const s = createServices(db, clock, prober ? { ...ports, prober: prober(ports) } : ports);
  cleanups.push(async () => {
    await s.monitor.stop();
    s.dashboard.stop();
    await s.retention.stop();
    db.close();
  });
  const add = (i: number, extra: { hostname?: string } = {}) =>
    s.devices.create(
      {
        name: `PC-${i}`,
        mac: `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
        ip: `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`,
        ...extra,
      },
      ACTOR,
    ).device.id;
  return { db, clock, ports, s, add };
}

/** A prober that answers each address after `ms` of fake time. */
const slowProber = (clock: FakeClock, ms: number, alive = false): Prober => ({
  probe: async (addresses) => {
    await clock.sleep(ms);
    return new Map(
      addresses.map((a) => [a, alive ? { alive: true, via: 'icmp', latencyMs: 1 } : DEAD]),
    );
  },
});

describe('M4-D: malformed input on the new endpoints', () => {
  const hs: ApiHarness[] = [];
  afterEach(async () => {
    for (const h of hs.splice(0)) await h.close();
  });

  it('uptime, history and events reject bad input with catalog errors, never 500', async () => {
    const h = await apiHarness();
    hs.push(h);
    const cookie = await h.as('operator');
    const status = async (url: string) => (await h.inject({ url, cookie })).statusCode;
    for (const url of [
      '/api/uptime?deviceId=abc',
      '/api/uptime?deviceId=1&days=0',
      '/api/uptime?deviceId=1&days=-5',
      '/api/uptime?deviceId=1&days=1e9',
      '/api/uptime?deviceId=1.5',
      `/api/uptime?roomId=${'9'.repeat(400)}`,
      '/api/devices/abc/history',
      '/api/devices/1/history?limit=0',
      '/api/devices/1/history?limit=201',
      '/api/devices/1/history?before=-1',
      '/api/devices/1/history?before=abc',
    ]) {
      expect([400, 422], url).toContain(await status(url));
    }
    expect(await status('/api/devices/999999999/history')).toBe(404);
    expect(await status(`/api/devices/${'9'.repeat(30)}/history`)).toBeLessThan(500);
    const longCookie = await h.inject({
      url: '/api/events',
      headers: { cookie: `uw_session=${'x'.repeat(4000)}` },
    });
    expect(longCookie.statusCode).toBe(401);
  });
});

describe('M4-D: deleting a device while a sweep is probing', () => {
  it('the sweep still commits every other device', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = world(() => ({
      probe: async (addresses) => {
        await gate;
        return new Map(addresses.map((a) => [a, { alive: true, via: 'icmp', latencyMs: 2 }]));
      },
    }));
    const keep = w.add(1);
    const gone = w.add(2);
    const sweep = w.s.monitor.sweep();
    await flushMicrotasks();
    w.s.devices.delete(gone, ACTOR);
    release();
    await expect(sweep).resolves.toMatchObject({ online: 2 });
    expect(w.s.devices.get(keep).status).toBe('online');
  });
});

describe('M4-D: stopping during a long sweep', () => {
  it('stop() does not wait for every queued probe of a 500-device sweep', async () => {
    // 2 s per address, 64 at a time: a full sweep takes ≈ 16 s.
    const db = testDb();
    const clock = new FakeClock(T0);
    const ports = fakePorts(clock);
    const s: Services = createServices(db, clock, { ...ports, prober: slowProber(clock, 2_000) });
    cleanups.push(() => db.close());
    for (let i = 0; i < 500; i++) {
      s.devices.create(
        {
          name: `S-${i}`,
          mac: `02:11:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
          ip: `10.9.${Math.floor(i / 250)}.${(i % 250) + 1}`,
        },
        ACTOR,
      );
    }
    s.monitor.start();
    await clock.advanceAsync(0);
    await clock.advanceAsync(3_000); // sweep in progress
    let stopped = false;
    const stopping = s.monitor.stop().then(() => (stopped = true));
    await clock.advanceAsync(2_000); // only the probes already in flight may finish
    expect(stopped).toBe(true);
    await stopping;
    // nothing half-written: statuses stay as they were
    expect(
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM device_events WHERE type = 'status'")!.n,
    ).toBe(0);
  });
});

describe('M4-D: starting twice', () => {
  it('monitor, rollup and retention each keep a single schedule', async () => {
    const w = world();
    w.add(1);
    w.s.monitor.start();
    w.s.monitor.start();
    w.s.dashboard.start();
    w.s.dashboard.start();
    w.s.retention.start();
    w.s.retention.start();
    expect(w.clock.pendingTimers).toBe(3);
    await w.clock.advanceAsync(0);
    expect(w.ports.prober.calls).toHaveLength(1);
  });
});

describe('M4-D: backwards clock jumps', () => {
  it('the hostname cache still expires after the clock jumps back a day', async () => {
    const w = world();
    w.add(1, { hostname: 'pc-a' });
    w.ports.dns.records.set('pc-a', ['10.0.0.2']);
    await w.s.monitor.sweep();
    w.clock.jump(-86_400_000);
    w.clock.advance(6 * 60_000);
    await w.s.monitor.sweep();
    expect(w.ports.dns.lookups).toBe(2);
  });

  it('a verification seen during a sweep survives a backwards jump in between', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = world(() => ({
      probe: async (addresses) => {
        await gate;
        return new Map(addresses.map((a) => [a, DEAD]));
      },
    }));
    const id = w.add(1);
    const sweep = w.s.monitor.sweep();
    await flushMicrotasks();
    w.clock.jump(-3_600_000);
    w.s.monitor.recordAlive([id]);
    release();
    await sweep;
    expect(w.s.devices.get(id).status).toBe('online');
  });
});

describe('M4-D: uptime beyond the retention window', () => {
  it('days whose history was purged are unknown (null), not 0%', () => {
    const w = world();
    w.clock.set(T0 - 400 * 86_400_000);
    const id = w.add(1);
    w.clock.set(T0);
    const series = w.s.dashboard.uptime({ deviceId: id, days: 366 });
    const ratios = series.days.map((d) => d.ratio);
    // retention.historyDays = 180: the oldest 186 days are gone
    expect(ratios.slice(0, 180).every((r) => r === null)).toBe(true);
    expect(ratios.at(-1)).not.toBeNull();
  });
});

describe('M4-D: demo seed', () => {
  it('seeds a data dir once, not again after the user emptied the inventory', () => {
    const db = testDb();
    const clock = new FakeClock(T0);
    const s = createServices(db, clock, fakePorts(clock), { demo: true });
    cleanups.push(() => db.close());
    const seed = () =>
      seedDemo({
        ...s,
        jobs: new SqliteJobsRepo(db),
        monitor: new SqliteMonitorRepo(db),
        transaction: (fn) => db.transaction(fn),
        setPower: () => undefined,
        neverWakes: (mac) => SimulatedNetwork.neverWakes(mac),
        demo: new SqliteDemoRepo(db),
        runs: new SqliteSchedulerRepo(db),
      });
    expect(seed()).not.toBeNull();
    db.run('DELETE FROM devices');
    db.run('DELETE FROM rooms');
    expect(seed()).toBeNull();
  });
});

describe('M4-D: DNS load', () => {
  it('a sweep resolves hostnames with bounded concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const w = world();
    w.ports.dns.resolve4 = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await w.clock.sleep(50);
      inFlight--;
      return ['10.0.0.9'];
    };
    for (let i = 0; i < 200; i++) w.add(i, { hostname: `pc-${i}` });
    const sweep = w.s.monitor.sweep();
    for (let t = 0; t < 40; t++) await w.clock.advanceAsync(50);
    await sweep;
    expect(peak).toBeLessThanOrEqual(32);
  });
});
