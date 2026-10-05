import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_INTERFACE,
  SimulatedNetwork,
  type SimDevice,
} from '../src/adapters/simulated-network';
import { seedDemo } from '../src/application/demo/demo-seed';
import { CONFIG_DEFAULTS, type Config, ConfigError, resolveConfig } from '../src/config';
import { SqliteDemoRepo } from '../src/db/repositories/demo-repo';
import { SqliteSchedulerRepo } from '../src/db/repositories/scheduler-repo';
import { SqliteJobsRepo } from '../src/db/repositories/jobs-repo';
import { SqliteMonitorRepo } from '../src/db/repositories/monitor-repo';
import { magicPacket } from '../src/domain/magic-packet';
import { createHub, type Hub } from '../src/hub';
import { createServices } from '../src/services';
import type * as UdpModule from '../src/adapters/udp-packet-sender';
import { FakeClock } from './fakes/fake-clock';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const udpConstructed = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/adapters/udp-packet-sender', async (importOriginal) => {
  const real = await importOriginal<typeof UdpModule>();
  class CountingUdpPacketSender extends real.UdpPacketSender {
    constructor(...args: ConstructorParameters<typeof real.UdpPacketSender>) {
      super(...args);
      udpConstructed.count++;
    }
  }
  return { ...real, UdpPacketSender: CountingUdpPacketSender };
});

const OPTS = { icmpTimeoutMs: 1000, tcpPorts: [445], tcpTimeoutMs: 800 };

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A MAC with the wanted simulated trait. */
function macWhere(pred: (mac: string) => boolean): string {
  for (let i = 0; i < 4096; i++) {
    const mac =
      `3C:52:82:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`.toUpperCase();
    if (pred(mac)) return mac;
  }
  throw new Error('no mac');
}

describe('SimulatedNetwork (FR-015)', () => {
  const wakes = macWhere((m) => !SimulatedNetwork.neverWakes(m) && !SimulatedNetwork.blocksIcmp(m));
  const never = macWhere((m) => SimulatedNetwork.neverWakes(m));
  const firewalled = macWhere((m) => SimulatedNetwork.blocksIcmp(m));

  function net(devices: SimDevice[]) {
    const clock = new FakeClock(T0);
    const sim = new SimulatedNetwork({
      clock,
      devices: () => devices,
      random: rng(1),
      wakeDelayMs: [20_000, 120_000],
      driftPerProbe: 0,
    });
    return { clock, sim };
  }

  it('a magic packet boots the machine 20–120 s later; ≈10% never wake', async () => {
    const { clock, sim } = net([
      { mac: wakes, ip: '10.20.1.11', hostname: 'lab1-pc01' },
      { mac: never, ip: '10.20.1.12', hostname: null },
    ]);
    sim.setPower(wakes, false);
    sim.setPower(never, false);
    for (const mac of [wakes, never]) {
      await sim.sender.send({
        sourceIp: DEMO_INTERFACE.address,
        destination: '10.20.255.255',
        port: 9,
        payload: magicPacket(mac),
      });
    }
    expect(sim.packets.map((p) => p.mac)).toEqual([wakes, never]);
    const probe = async () =>
      [...(await sim.prober.probe(['10.20.1.11', '10.20.1.12', '10.20.9.9'], OPTS)).values()].map(
        (r) => r.alive,
      );
    expect(await probe()).toEqual([false, false, false]);
    clock.advance(19_999);
    expect(await probe()).toEqual([false, false, false]);
    clock.advance(100_001);
    expect(await probe()).toEqual([true, false, false]);

    let neverCount = 0;
    for (let i = 0; i < 1000; i++)
      if (
        SimulatedNetwork.neverWakes(
          `3C:52:82:01:${(i >> 8).toString(16)}:${(i & 255).toString(16)}`,
        )
      )
        neverCount++;
    expect(neverCount).toBeGreaterThan(60);
    expect(neverCount).toBeLessThan(140);
  });

  it('answers ICMP-blocked machines over TCP, resolves demo hostnames and offers one simulated NIC', async () => {
    const { sim } = net([{ mac: firewalled, ip: '10.20.2.11', hostname: 'LAB2-PC01' }]);
    sim.setPower(firewalled, true);
    expect((await sim.prober.probe(['10.20.2.11'], OPTS)).get('10.20.2.11')).toMatchObject({
      alive: true,
      via: 'tcp',
    });
    expect(await sim.dns.resolve4('lab2-pc01')).toEqual(['10.20.2.11']);
    await expect(sim.dns.resolve4('nada')).rejects.toThrow('ENOTFOUND');
    expect(await sim.interfaces.list()).toEqual([DEMO_INTERFACE]);
  });

  it('seeded machines switch on and off by themselves now and then (lively panel)', async () => {
    const clock = new FakeClock(T0);
    const devices = Array.from({ length: 50 }, (_, i) => ({
      mac: macWhere(
        (m) =>
          !SimulatedNetwork.neverWakes(m) &&
          m.endsWith(`:${(i + 1).toString(16).padStart(2, '0').toUpperCase()}`),
      ),
      ip: `10.20.3.${i + 11}`,
      hostname: null,
    }));
    const sim = new SimulatedNetwork({
      clock,
      devices: () => devices,
      random: rng(7),
      driftPerProbe: 0.05,
    });
    devices.forEach((d, i) => sim.setPower(d.mac, i % 2 === 0)); // seeded = lively
    const ips = devices.map((d) => d.ip);
    const first = [...(await sim.prober.probe(ips, OPTS)).values()].map((r) => r.alive);
    let changed = 0;
    for (let k = 0; k < 10; k++) {
      const now = [...(await sim.prober.probe(ips, OPTS)).values()].map((r) => r.alive);
      changed += now.filter((a, i) => a !== first[i]).length;
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('demo seed (FR-015)', () => {
  function world() {
    const db = testDb();
    const clock = new FakeClock(T0);
    const services = createServices(db, clock, fakePorts(clock), { demo: true });
    const power = new Map<string, boolean>();
    const seed = () =>
      seedDemo({
        ...services,
        jobs: new SqliteJobsRepo(db),
        monitor: new SqliteMonitorRepo(db),
        transaction: (fn) => db.transaction(fn),
        random: rng(3),
        setPower: (mac, on) => power.set(mac, on),
        neverWakes: (mac) => SimulatedNetwork.neverWakes(mac),
        demo: new SqliteDemoRepo(db),
        runs: new SqliteSchedulerRepo(db),
      });
    return { db, services, power, seed };
  }

  it('seeds rooms, 60 devices, tags, a week of history and a past morning wake', () => {
    const { db, services, power, seed } = world();
    const r = seed();
    expect(r).toMatchObject({ rooms: 4, devices: 60 });
    expect(r!.events).toBeGreaterThan(200);
    expect(power.size).toBe(60);

    const dash = services.dashboard.dashboard();
    expect(dash.rooms.map((x) => x.name)).toEqual([
      'Laboratório 1',
      'Laboratório 2',
      'Laboratório 3',
      'Biblioteca',
    ]);
    expect(dash.noRoom?.total).toBe(2);
    expect(dash.tags.map((t) => t.name).sort()).toEqual([
      'Mesa do professor',
      'Projetor',
      'Windows 11',
    ]);
    const last = dash.rooms[0]!.lastAction!;
    expect(last).toMatchObject({ source: 'schedule', state: 'concluido', dryRun: true, total: 18 });
    expect(last.woke + last.noResponse).toBe(18);

    // FR-015 (M5-T07): two schedules and yesterday's morning result
    const schedules = services.schedules.list();
    expect(schedules.map((s) => [s.name, s.weekdays, s.timeLocal])).toEqual([
      ['Abertura dos laboratórios', 31, '06:50'],
      ['Biblioteca aos sábados', 32, '08:00'],
    ]);
    expect(schedules[0]).toMatchObject({ targetCount: 48, confirmedCount: 48 });
    const runs = services.schedules.runs({ page: 1, pageSize: 10 });
    expect(runs.items).toMatchObject([
      { status: 'executado', scheduleName: 'Abertura dos laboratórios' },
    ]);
    expect(runs.items[0]!.jobId).toBe(last.jobId);
    const notices = services.notices.list();
    expect(notices.map((n) => n.type)).toEqual(['morning_result']);
    expect(JSON.stringify(notices[0]!.data)).toContain('nao_respondeu');

    expect(services.dashboard.rollupPending()).toHaveLength(8); // inventory backdated 8 days
    const week = services.dashboard.uptime({ roomId: dash.rooms[0]!.id, days: 7 });
    expect(week.average).toBeGreaterThan(0.1);
    // "Nunca respondeu" only for machines with no history at all.
    const flagged = db.all<{ n: number }>(
      'SELECT COUNT(*) AS n FROM device_state WHERE ever_online = 0',
    )[0]!.n;
    expect(flagged).toBeLessThan(15);
  });

  it('never touches an inventory that already exists', () => {
    const { services, seed } = world();
    services.rooms.create({ name: 'Sala real' }, { id: null, label: 't' });
    expect(seed()).toBeNull();
    expect(services.dashboard.dashboard().rooms).toHaveLength(1);
  });
});

describe('demo config', () => {
  it('reads UNIWAKE_DEMO_SEED and UNIWAKE_DEMO_WAKE_MS', () => {
    expect(resolveConfig(null, {}, { dataDir: 'x' })).toMatchObject({
      demoSeed: true,
      demoWakeDelayMs: [20_000, 120_000],
    });
    expect(
      resolveConfig(
        null,
        { UNIWAKE_DEMO_SEED: '0', UNIWAKE_DEMO_WAKE_MS: '500-1500' },
        { dataDir: 'x' },
      ),
    ).toMatchObject({ demoSeed: false, demoWakeDelayMs: [500, 1500] });
    expect(() => resolveConfig(null, { UNIWAKE_DEMO_WAKE_MS: '9-1' }, { dataDir: 'x' })).toThrow(
      ConfigError,
    );
    expect(() => resolveConfig(null, { UNIWAKE_DEMO_WAKE_MS: 'abc' }, { dataDir: 'x' })).toThrow(
      ConfigError,
    );
  });
});

describe('demo hub (AC-015-01)', () => {
  const dirs: string[] = [];
  const hubs: Hub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.stop();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function config(overrides: Partial<Config>): Config {
    const dataDir = mkdtempSync(join(tmpdir(), 'uniwake-demo-'));
    dirs.push(dataDir);
    return {
      ...CONFIG_DEFAULTS,
      panelPort: 0,
      agentPort: 0,
      agentBind: '127.0.0.1',
      dataDir,
      demo: false,
      ...overrides,
    };
  }
  const silent = pino({ level: 'silent' });

  it('AC-015-01: a demo start on an empty data dir seeds data and never constructs the real sender', async () => {
    udpConstructed.count = 0;
    const hub = await createHub({ config: config({ demo: true }), logger: silent });
    hubs.push(hub);
    await hub.start();
    expect(udpConstructed.count).toBe(0);
    const s = hub.services;
    expect(s.dashboard.dashboard().counters.total).toBe(60);

    // R-M3-03: a demo wake works without any real interface and is recorded, not sent.
    const room = s.dashboard.dashboard().rooms[0]!;
    const { jobId } = s.wake.start(
      { target: { type: 'rooms', roomIds: [room.id], includeNoRoom: false }, onlyOffline: false },
      { id: null, label: 't' },
      { preConfirmed: true },
    );
    expect(s.wake.job(jobId).job.dryRun).toBe(true);
    for (let i = 0; i < 50 && s.wake.packets(jobId).length === 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(s.wake.packets(jobId).length).toBeGreaterThan(0);
    expect(
      s.wake
        .packets(jobId)
        .every((p) => p.outcome === 'dry_run' && p.srcIp === DEMO_INTERFACE.address),
    ).toBe(true);
  });

  it('UNIWAKE_DEMO_SEED=0 starts an empty demo; a normal hub does construct the UDP sender', async () => {
    const demo = await createHub({
      config: config({ demo: true, demoSeed: false }),
      logger: silent,
    });
    hubs.push(demo);
    await demo.start();
    expect(demo.services.dashboard.dashboard().counters.total).toBe(0);

    udpConstructed.count = 0;
    const real = await createHub({ config: config({}), logger: silent });
    hubs.push(real);
    expect(udpConstructed.count).toBe(1); // proves the counter above would have seen it
  });
});
