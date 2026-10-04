import { afterEach, describe, expect, it } from 'vitest';
import type { HubEvent } from '../src/application/events-bus';
import { ProbeQueue } from '../src/application/monitor/probe-queue';
import type { Clock, Prober, ProbeOptions, ProbeResult } from '../src/application/ports';
import { createServices, type Services } from '../src/services';
import { FakeClock, flushMicrotasks } from './fakes/fake-clock';
import { T0, testDb } from './helpers/db';
import { type FakePorts, fakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const OPTS: ProbeOptions = { icmpTimeoutMs: 1000, tcpPorts: [445], tcpTimeoutMs: 800 };

interface World {
  s: Services;
  clock: FakeClock;
  ports: FakePorts;
  events: HubEvent[];
  add(i: number, extra?: { ip?: string | null; hostname?: string }): number;
}

const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) {
    await w.s.monitor.stop();
    w.s.db.close();
  }
});

function world(prober?: Prober): World {
  const db = testDb();
  const clock = new FakeClock(T0);
  const ports = fakePorts(clock);
  const s = createServices(db, clock, prober ? { ...ports, prober } : ports);
  const events: HubEvent[] = [];
  s.events.subscribe((e) => events.push(e));
  const w: World = {
    s,
    clock,
    ports,
    events,
    add(i, extra = {}) {
      const mac = `00:BB:00:00:${Math.floor(i / 256)
        .toString(16)
        .padStart(2, '0')}:${(i % 256).toString(16).padStart(2, '0')}`;
      return s.devices.create(
        {
          name: `PC-${i}`,
          mac,
          ip: extra.ip === undefined ? `10.0.${Math.floor(i / 250)}.${(i % 250) + 2}` : extra.ip,
          hostname: extra.hostname,
        },
        ACTOR,
      ).device.id;
    },
  };
  worlds.push(w);
  return w;
}

const statusOf = (w: World, id: number) => w.s.devices.get(id).status;
const eventsOf = (w: World, id: number) =>
  w.s.db.all<{ type: string; data: string }>(
    'SELECT type, data FROM device_events WHERE device_id = ? ORDER BY id',
    [id],
  );

describe('MonitorService sweeps', () => {
  it('AC-004-01 AC-004-04: a sweep marks responding devices online and debounces offline', async () => {
    const w = world();
    const a = w.add(1);
    const b = w.add(2);
    w.ports.prober.setAlive(w.s.devices.get(a).ip!, 'icmp', 3);
    w.ports.prober.setAlive(w.s.devices.get(b).ip!, 'tcp', 9);

    const r1 = await w.s.monitor.sweep();
    expect(r1).toMatchObject({ probed: 2, online: 2, changed: 2 });
    expect(w.s.devices.get(a)).toMatchObject({ status: 'online', latencyMs: 3, everOnline: true });

    w.ports.prober.setOffline(w.s.devices.get(b).ip!);
    await w.s.monitor.sweep();
    expect(statusOf(w, b)).toBe('online'); // one failed sweep is packet loss
    await w.s.monitor.sweep();
    expect(statusOf(w, b)).toBe('offline');
    const statusEvents = eventsOf(w, b).filter((e) => e.type === 'status');
    expect(statusEvents.map((e) => JSON.parse(e.data) as { to: string }).map((d) => d.to)).toEqual([
      'online',
      'offline',
    ]);
    expect(w.events.filter((e) => e.type === 'device.status')).toHaveLength(3);
    expect(w.events.some((e) => e.type === 'counters')).toBe(true);
  });

  it('AC-004-05: no IP and an unresolvable hostname is desconhecido without probing', async () => {
    const w = world();
    const id = w.add(1, { ip: null, hostname: 'lab-sumido' });
    await w.s.monitor.sweep();
    expect(statusOf(w, id)).toBe('desconhecido');
    expect(w.ports.prober.calls.flatMap((c) => c.addresses)).toEqual([]);
  });

  it('AC-004-07: a hostname that now resolves elsewhere moves the IP and records ip_changed', async () => {
    const w = world();
    const id = w.add(1, { ip: '10.0.3.20', hostname: 'LAB1-PC05' });
    w.ports.dns.records.set('lab1-pc05', ['10.0.3.31']);
    w.ports.prober.setAlive('10.0.3.31');

    await w.s.monitor.sweep();
    expect(w.s.devices.get(id)).toMatchObject({ ip: '10.0.3.31', status: 'online' });
    const drift = eventsOf(w, id).find((e) => e.type === 'ip_changed');
    expect(JSON.parse(drift!.data)).toEqual({ from: '10.0.3.20', to: '10.0.3.31' });
    expect(w.ports.prober.calls.flatMap((c) => c.addresses)).toEqual(['10.0.3.31']);
  });

  it('AC-004-07: hostnames are cached for monitor.dnsCacheMinutes', async () => {
    const w = world();
    w.add(1, { ip: '10.0.3.20', hostname: 'pc-a' });
    w.ports.dns.records.set('pc-a', ['10.0.3.20']);
    await w.s.monitor.sweep();
    await w.s.monitor.sweep();
    expect(w.ports.dns.lookups).toBe(1);
    w.clock.advance(5 * 60_000);
    await w.s.monitor.sweep();
    expect(w.ports.dns.lookups).toBe(2);
  });

  it('fault: a DNS failure falls back to the stored IP', async () => {
    const w = world();
    const id = w.add(1, { ip: '10.0.3.20', hostname: 'pc-a' });
    w.ports.dns.faults.failWhen(() => true, new Error('ETIMEOUT'));
    w.ports.prober.setAlive('10.0.3.20');
    await w.s.monitor.sweep();
    expect(w.s.devices.get(id)).toMatchObject({ ip: '10.0.3.20', status: 'online' });
  });

  it('fault: a failing prober reads as no answer, not as a crash', async () => {
    const w = world();
    const id = w.add(1);
    w.ports.prober.setAlive(w.s.devices.get(id).ip!);
    await w.s.monitor.sweep();
    w.ports.prober.faults.failNext(10, new Error('helper deadline'));
    await w.s.monitor.sweep();
    expect(statusOf(w, id)).toBe('online'); // debounced: one bad sweep never flips it
  });

  it('fault: a database error aborts the whole sweep atomically and publishes nothing', async () => {
    const w = world();
    const a = w.add(1);
    const b = w.add(2, { ip: '10.0.3.20', hostname: 'pc-b' });
    w.ports.dns.records.set('pc-b', ['10.0.3.31']);
    w.ports.prober.setAlive(w.s.devices.get(a).ip!);
    const db = w.s.db;
    const original = db.run.bind(db);
    db.run = (sql, params) => {
      if (sql.startsWith('INSERT INTO device_events'))
        throw new Error('SQLITE_BUSY: database is locked');
      return original(sql, params);
    };
    await expect(w.s.monitor.sweep()).rejects.toThrow('SQLITE_BUSY');
    db.run = original;
    expect(statusOf(w, a)).toBe('desconhecido');
    expect(w.s.devices.get(b).ip).toBe('10.0.3.20');
    expect(w.events).toEqual([]);
  });

  it('disabled devices are not probed and read desconhecido', async () => {
    const w = world();
    const id = w.add(1);
    w.ports.prober.setAlive(w.s.devices.get(id).ip!);
    await w.s.monitor.sweep();
    w.s.devices.update(id, { enabled: false }, ACTOR);
    w.ports.prober.calls.length = 0;
    await w.s.monitor.sweep();
    expect(w.ports.prober.calls.flatMap((c) => c.addresses)).toEqual([]);
    const row = w.s.db.get<{ status: string }>(
      'SELECT status FROM device_state WHERE device_id = ?',
      [id],
    );
    expect(row?.status).toBe('desconhecido');
  });

  it('concurrent sweep calls share one run', async () => {
    const w = world();
    w.add(1);
    const [r1, r2] = await Promise.all([w.s.monitor.sweep(), w.s.monitor.sweep()]);
    expect(r1).toBe(r2);
    expect(w.ports.prober.calls).toHaveLength(1);
  });
});

describe('MonitorService lifecycle', () => {
  it('AC-004-11: at hub start every device is desconhecido until probed', async () => {
    const w = world();
    const a = w.add(1);
    const b = w.add(2);
    w.ports.prober.setAlive(w.s.devices.get(a).ip!);
    await w.s.monitor.sweep();
    w.ports.prober.setOffline(w.s.devices.get(a).ip!);
    await w.s.monitor.sweep();
    await w.s.monitor.sweep();
    expect([statusOf(w, a), statusOf(w, b)]).toEqual(['offline', 'offline']);
    w.ports.prober.setAlive(w.s.devices.get(a).ip!);
    await w.s.monitor.sweep();
    w.events.length = 0;

    // "Restart": a fresh monitor start clears stale statuses before the first sweep.
    w.ports.prober.setOffline(w.s.devices.get(a).ip!);
    w.s.monitor.start();
    expect([statusOf(w, a), statusOf(w, b)]).toEqual(['desconhecido', 'desconhecido']);
    expect(w.s.devices.get(a).lastSeenAt).toBe(T0); // history survives the reset
    expect(w.events).toEqual([{ type: 'counters' }]);
    const reset = eventsOf(w, a).at(-1)!;
    expect(JSON.parse(reset.data)).toMatchObject({
      from: 'online',
      to: 'desconhecido',
      reason: 'hub_start',
    });
  });

  it('AC-004-12: a device never seen online keeps the "nunca respondeu" flag across restarts', async () => {
    const w = world();
    const never = w.add(1);
    const seen = w.add(2);
    w.ports.prober.setAlive(w.s.devices.get(seen).ip!);
    await w.s.monitor.sweep();
    w.s.monitor.start();
    await w.s.monitor.stop();
    expect(w.s.devices.get(never).flags.neverResponded).toBe(true);
    expect(w.s.devices.get(seen).flags.neverResponded).toBe(false);
  });

  it('sweeps every monitor.intervalSeconds and stop() ends the loop', async () => {
    const w = world();
    w.add(1);
    w.s.monitor.start();
    await w.clock.advanceAsync(0);
    expect(w.ports.prober.calls).toHaveLength(1);
    await w.clock.advanceAsync(59_000);
    expect(w.ports.prober.calls).toHaveLength(1);
    await w.clock.advanceAsync(1_000);
    expect(w.ports.prober.calls).toHaveLength(2);
    w.s.settings.update({ 'monitor.intervalSeconds': 10 }, null);
    await w.clock.advanceAsync(60_000);
    expect(w.ports.prober.calls).toHaveLength(3);
    await w.clock.advanceAsync(10_000);
    expect(w.ports.prober.calls).toHaveLength(4);
    await w.s.monitor.stop();
    await w.clock.advanceAsync(600_000);
    expect(w.ports.prober.calls).toHaveLength(4);
    expect(w.clock.pendingTimers).toBe(0);
  });

  it('a failed sweep is logged and the loop keeps going', async () => {
    const w = world();
    w.add(1);
    const db = w.s.db;
    const original = db.transaction.bind(db);
    w.s.monitor.start();
    let failures = 1; // the first sweep's write fails
    db.transaction = <T>(fn: () => T): T => {
      if (failures-- > 0) throw new Error('SQLITE_BUSY');
      return original(fn);
    };
    await w.clock.advanceAsync(0);
    expect(w.ports.logger.entries.some((e) => e.msg === 'monitoring sweep failed')).toBe(true);
    await w.clock.advanceAsync(60_000);
    expect(w.s.monitor.lastSweep?.probed).toBe(1);
    db.transaction = original;
  });

  it('stop() waits for the probe in flight, then the sweep ends without writing (M4-F2)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Prober = {
      probe: async (addresses) => {
        await gate;
        return new Map(addresses.map((a) => [a, { alive: true, via: 'icmp', latencyMs: 1 }]));
      },
    };
    const w = world(slow);
    const id = w.add(1);
    const sweep = w.s.monitor.sweep();
    let stopped = false;
    const stopping = w.s.monitor.stop().then(() => (stopped = true));
    await flushMicrotasks();
    expect(stopped).toBe(false);
    release();
    await Promise.all([sweep, stopping]);
    expect(statusOf(w, id)).toBe('desconhecido');
    expect(eventsOf(w, id)).toEqual([]);
  });
});

/** Answers after realistic latencies on the fake clock: 2–20 ms alive, ICMP + TCP timeouts dead. */
class LatencyProber implements Prober {
  inFlight = 0;
  peak = 0;
  constructor(
    private readonly clock: Clock,
    private readonly alive: (address: string) => boolean,
  ) {}
  async probe(addresses: readonly string[], opts: ProbeOptions): Promise<Map<string, ProbeResult>> {
    const out = new Map<string, ProbeResult>();
    await Promise.all(
      addresses.map(async (a) => {
        this.inFlight++;
        this.peak = Math.max(this.peak, this.inFlight);
        const up = this.alive(a);
        const latency = up
          ? 2 + (a.charCodeAt(a.length - 1) % 19)
          : opts.icmpTimeoutMs + opts.tcpTimeoutMs;
        await this.clock.sleep(latency);
        this.inFlight--;
        out.set(
          a,
          up
            ? { alive: true, via: 'icmp', latencyMs: latency }
            : { alive: false, via: null, latencyMs: null },
        );
      }),
    );
    return out;
  }
}

describe('sweep scale (NFR-01)', () => {
  it('AC-004-06: 500 devices, half timing out, sweep in under 30 s of simulated time', async () => {
    const clock = new FakeClock(T0);
    const odd = (a: string) => Number(a.split('.')[3]) % 2 === 1;
    const prober = new LatencyProber(clock, odd);
    const db = testDb();
    const ports = fakePorts(clock);
    const s = createServices(db, clock, { ...ports, prober });
    worlds.push({ s, clock, ports, events: [], add: () => 0 });
    for (let i = 0; i < 500; i++) {
      s.devices.create(
        {
          name: `PC-${i}`,
          mac: `00:CC:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
          ip: `10.1.${Math.floor(i / 250)}.${(i % 250) + 2}`,
        },
        ACTOR,
      );
    }
    let report: Awaited<ReturnType<Services['monitor']['sweep']>> | undefined;
    void s.monitor.sweep().then((r) => (report = r));
    for (let t = 0; t < 120_000 && !report; t += 100) await clock.advanceAsync(100);

    expect(report).toBeDefined();
    expect(report!.probed).toBe(500);
    expect(report!.online + report!.offline).toBe(500);
    expect(report!.offline).toBe(250);
    expect(report!.durationMs).toBeLessThan(30_000);
    expect(prober.peak).toBeLessThanOrEqual(64); // monitor.concurrency default
  });
});

describe('ProbeQueue', () => {
  it('AC-004-13: verification probes jump ahead of a sweep already queued', async () => {
    const order: string[] = [];
    const gates: (() => void)[] = [];
    const prober: Prober = {
      probe: (addresses) => {
        order.push(addresses[0]!);
        return new Promise((resolve) => {
          gates.push(() =>
            resolve(new Map([[addresses[0]!, { alive: true, via: 'icmp', latencyMs: 1 }]])),
          );
        });
      },
    };
    const q = new ProbeQueue(prober, () => 2);
    const sweepAddrs = Array.from({ length: 10 }, (_, i) => `10.0.0.${i + 1}`);
    const sweep = q.at('low').probe(sweepAddrs, OPTS);
    await flushMicrotasks();
    expect(q.pending).toEqual({ high: 0, low: 8, active: 2 });

    const verify = q.at('high').probe(['10.9.9.9'], OPTS);
    gates.shift()!();
    await flushMicrotasks();
    expect(order.slice(0, 3)).toEqual(['10.0.0.1', '10.0.0.2', '10.9.9.9']);

    while (gates.length > 0) {
      gates.shift()!();
      await flushMicrotasks();
    }
    expect((await verify).get('10.9.9.9')?.alive).toBe(true);
    expect((await sweep).size).toBe(10);
  });

  it('never runs more than monitor.concurrency probes and dedupes addresses', async () => {
    let active = 0;
    let peak = 0;
    const clock = new FakeClock(T0);
    const prober: Prober = {
      probe: async (addresses) => {
        active++;
        peak = Math.max(peak, active);
        await clock.sleep(10);
        active--;
        return new Map(addresses.map((a) => [a, { alive: false, via: null, latencyMs: null }]));
      },
    };
    let limit = 3;
    const q = new ProbeQueue(prober, () => limit);
    const done = q.probe(['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g'], OPTS, 'low');
    await clock.advanceAsync(15);
    limit = 1;
    for (let i = 0; i < 20; i++) await clock.advanceAsync(10);
    const r = await done;
    expect([...r.keys()]).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(peak).toBe(3);
  });

  it('a rejected probe resolves as no answer and the queue keeps draining', async () => {
    const prober: Prober = {
      probe: (addresses) =>
        addresses[0] === 'bad'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(new Map([[addresses[0]!, { alive: true, via: 'tcp', latencyMs: 4 }]])),
    };
    const q = new ProbeQueue(prober, () => 1);
    const r = await q.probe(['bad', 'good'], OPTS, 'high');
    expect(r.get('bad')).toEqual({ alive: false, via: null, latencyMs: null });
    expect(r.get('good')?.alive).toBe(true);
  });
});

describe('verification counts as a positive probe (FR-004.1)', () => {
  it('a device answering wake verification is online at once, with an event', async () => {
    const w = world();
    const id = w.add(1);
    await w.s.monitor.sweep(); // offline
    w.events.length = 0;
    w.ports.prober.setAlive(w.s.devices.get(id).ip!);
    const { jobId } = w.s.wake.start(
      { target: { type: 'devices', deviceIds: [id] }, onlyOffline: false },
      ACTOR,
      { preConfirmed: true },
    );
    for (let t = 0; t < 120 && w.s.wake.job(jobId).devices[0]!.result !== 'acordou'; t++) {
      await w.clock.advanceAsync(1000);
    }
    expect(w.s.wake.job(jobId).devices[0]!.result).toBe('acordou');
    expect(statusOf(w, id)).toBe('online'); // no sweep ran in between
    expect(JSON.parse(eventsOf(w, id).at(-1)!.data)).toMatchObject({
      from: 'offline',
      to: 'online',
      via: 'verification',
    });
    expect(w.events).toContainEqual(
      expect.objectContaining({ type: 'device.status', deviceId: id, status: 'online' }),
    );
    expect(w.events).toContainEqual({ type: 'counters' });
    for (let t = 0; t < 900 && w.s.runner.activeCount > 0; t++) await w.clock.advanceAsync(1000);
  });

  it('a sweep that probed before the device booted does not undo the verification result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Prober = {
      probe: async (addresses) => {
        await gate; // the sweep's probe saw nothing...
        return new Map(addresses.map((a) => [a, { alive: false, via: null, latencyMs: null }]));
      },
    };
    const w = world(slow);
    const id = w.add(1);
    const sweep = w.s.monitor.sweep();
    await flushMicrotasks();
    w.s.monitor.recordAlive([id]); // ...but verification saw it answer meanwhile
    release();
    await sweep;
    expect(statusOf(w, id)).toBe('online');
  });

  it('disabled devices and unknown ids are ignored', () => {
    const w = world();
    const id = w.add(1);
    w.s.devices.update(id, { enabled: false }, ACTOR);
    w.s.monitor.recordAlive([id, 999]);
    w.s.monitor.recordAlive([]);
    expect(
      w.s.db.get<{ status: string }>('SELECT status FROM device_state WHERE device_id = ?', [id])
        ?.status,
    ).not.toBe('online');
    expect(eventsOf(w, id)).toEqual([]);
    expect(w.events).toEqual([]);
  });
});

describe('ProbeQueue.cancelPending (M4-F2)', () => {
  it('answers queued probes of one priority at once and leaves the others', async () => {
    const gates: (() => void)[] = [];
    const prober: Prober = {
      probe: (addresses) =>
        new Promise((resolve) =>
          gates.push(() =>
            resolve(new Map([[addresses[0]!, { alive: true, via: 'icmp', latencyMs: 1 }]])),
          ),
        ),
    };
    const q = new ProbeQueue(prober, () => 1);
    const low = q.probe(['a', 'b', 'c'], OPTS, 'low');
    const high = q.probe(['h'], OPTS, 'high');
    await flushMicrotasks();
    expect(q.cancelPending('low')).toBe(2); // 'a' is in flight
    gates.shift()!();
    await flushMicrotasks();
    gates.shift()!();
    const r = await low;
    expect([...r.values()].map((x) => x.alive)).toEqual([true, false, false]);
    expect((await high).get('h')?.alive).toBe(true);
  });
});
