import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryState } from '@uniwake/shared';
import { AuditService } from '../src/application/audit/audit-service';
import { DiscoveryService } from '../src/application/discovery/discovery-service';
import { SettingsService } from '../src/application/settings/settings-service';
import { cidrOf, hostsOf, parseCidr, within } from '../src/domain/cidr';
import type { Neighbor } from '../src/domain/neighbors';
import { parseOuiTable } from '../src/domain/oui';
import { SqliteAuditRepo } from '../src/db/repositories/audit-repo';
import { SqliteSettingsRepo } from '../src/db/repositories/settings-repo';
import { FakeClock } from './fakes/fake-clock';
import { FakeDnsResolver, FakeNetworkInterfaces, FakeProber, iface } from './fakes/network-fakes';
import { MemoryLogger } from './fakes/system-fakes';
import { T0, testDb } from './helpers/db';

const ACTOR = { id: 1, label: 'ana' };

describe('CIDR helpers', () => {
  it('parses, normalizes and enumerates host addresses', () => {
    const c = parseCidr('10.0.3.77/24')!;
    expect(c.hosts).toBe(254);
    expect([...hostsOf(parseCidr('10.0.3.0/30')!)]).toEqual(['10.0.3.1', '10.0.3.2']);
    expect(cidrOf('10.0.3.15', 24)).toBe('10.0.3.0/24');
    expect(within(parseCidr('10.0.3.128/25')!, parseCidr('10.0.3.0/24')!)).toBe(true);
    expect(within(parseCidr('10.0.0.0/16')!, parseCidr('10.0.3.0/24')!)).toBe(false);
    for (const bad of ['10.0.3.0', '10.0.3.0/33', '300.0.0.0/8', 'x/24'])
      expect(parseCidr(bad)).toBeNull();
  });
});

function setup() {
  const db = testDb();
  const clock = new FakeClock(T0);
  const prober = new FakeProber();
  const interfaces = new FakeNetworkInterfaces([
    iface({ name: 'Ethernet', address: '10.0.3.15', prefixLength: 24, gateway: '10.0.3.1' }),
    iface({ name: 'Grande', address: '172.16.5.10', prefixLength: 20, gateway: null }),
  ]);
  let neighbors: Neighbor[] = [];
  const dns = new FakeDnsResolver();
  const names = new Map([['10.0.3.42', ['lab3-pc42.faculdade.local']]]);
  dns.reverse = (ip: string) => Promise.resolve(names.get(ip) ?? []);
  const registered = new Map([['00:1A:2B:3C:4D:41', { id: 7, name: 'PC-41' }]]);
  const created: { name: string; mac: string; roomId: number | null }[] = [];
  const audit = new AuditService(new SqliteAuditRepo(db), clock);
  const probe = vi.spyOn(prober, 'probe');
  const service = new DiscoveryService({
    prober,
    neighbors: { read: () => Promise.resolve(neighbors) },
    dns,
    interfaces,
    oui: () => parseOuiTable('001A2B\tAyecom Technology Co., Ltd.\n'),
    findByMac: (mac) => registered.get(mac),
    roomName: (id) => (id === 3 ? 'Lab 3' : undefined),
    createDevice: (d) => {
      created.push(d);
      registered.set(d.mac, { id: 100 + created.length, name: d.name });
    },
    transaction: (fn) => db.transaction(fn),
    settings: new SettingsService(new SqliteSettingsRepo(db), clock),
    audit,
    clock,
    logger: new MemoryLogger(),
  });
  const done = async (): Promise<DiscoveryState> => {
    await vi.waitFor(async () => expect((await service.status()).state).toBe('done'));
    return service.status();
  };
  return {
    service,
    prober,
    probe,
    clock,
    created,
    done,
    setNeighbors: (n: Neighbor[]) => (neighbors = n),
    audits: () => audit.query({ limit: 20, offset: 0 }).items,
  };
}

const n = (ip: string, mac: string): Neighbor => ({ ip, mac, interfaceIp: '10.0.3.15' });

describe('discovery (FR-101)', () => {
  it('sweeps a subnet of this computer and lists answers with vendor, name, latency and flags', async () => {
    const t = setup();
    t.prober.setAlive('10.0.3.41', 'icmp', 3);
    t.prober.setAlive('10.0.3.42', 'tcp', 9);
    t.setNeighbors([
      n('10.0.3.41', '00:1A:2B:3C:4D:41'),
      n('10.0.3.42', '02:AA:BB:CC:DD:42'),
      n('10.0.9.5', '00:1A:2B:3C:4D:95'), // another subnet: not part of this sweep
    ]);
    const started = await t.service.scan({ cidr: '10.0.3.0/24' }, ACTOR);
    expect(started).toMatchObject({ state: 'running', cidr: '10.0.3.0/24', total: 254 });
    const s = await t.done();
    expect(s.probed).toBe(254);
    expect(t.probe).toHaveBeenCalledTimes(1); // one batch of ≤ 256 addresses
    expect(s.found).toEqual([
      {
        ip: '10.0.3.41',
        mac: '00:1A:2B:3C:4D:41',
        vendor: 'Ayecom Technology Co., Ltd.',
        hostname: null,
        latencyMs: 3,
        firstSeenAt: T0,
        lastSeenAt: T0,
        registered: { id: 7, name: 'PC-41' },
        locallyAdministered: false,
      },
      {
        ip: '10.0.3.42',
        mac: '02:AA:BB:CC:DD:42',
        vendor: null,
        hostname: 'LAB3-PC42',
        latencyMs: 9,
        firstSeenAt: T0,
        lastSeenAt: T0,
        registered: null,
        locallyAdministered: true,
      },
    ]);
    expect(s.subnets).toEqual([
      { name: 'Ethernet', cidr: '10.0.3.0/24', hosts: 254 },
      { name: 'Grande', cidr: '172.16.0.0/20', hosts: 4094 },
    ]);
    expect(t.audits()[0]).toMatchObject({
      action: 'discovery.scan',
      target: 'network:10.0.3.0/24',
    });
  });

  it('AC-101-01: more than a /22 needs confirmation', async () => {
    const t = setup();
    await expect(t.service.scan({ cidr: '172.16.0.0/20' }, ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [
        { path: 'confirmLarge', message: expect.stringContaining('4094 endereços') as string },
      ],
    });
    expect(t.probe).not.toHaveBeenCalled();
    await t.service.scan({ cidr: '172.16.0.0/20', confirmLarge: true }, ACTOR);
    const s = await t.done();
    expect(s.probed).toBe(4094);
    expect(t.probe).toHaveBeenCalledTimes(16);
  });

  it("only sweeps this computer's own subnets", async () => {
    const t = setup();
    for (const cidr of ['10.0.4.0/24', '10.0.0.0/16', '8.8.8.0/24', 'nope']) {
      await expect(t.service.scan({ cidr }, ACTOR), cidr).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    expect(t.probe).not.toHaveBeenCalled();
    await expect(t.service.scan({ cidr: '10.0.3.128/25' }, ACTOR)).resolves.toMatchObject({
      total: 126,
    });
  });

  it('AC-101-03: a registered MAC is "já cadastrado" and is never added twice', async () => {
    const t = setup();
    t.setNeighbors([n('10.0.3.41', '00:1A:2B:3C:4D:41'), n('10.0.3.42', '00:1A:2B:3C:4D:42')]);
    await t.service.scan({ cidr: '10.0.3.0/24' }, ACTOR);
    await t.done();
    const r = t.service.add(
      {
        roomId: 3,
        devices: [
          { mac: '00:1A:2B:3C:4D:41', ip: '10.0.3.41', name: 'PC-41' },
          { mac: '00:1A:2B:3C:4D:42', ip: '10.0.3.42', name: 'PC-42', hostname: 'LAB3-PC42' },
        ],
      },
      ACTOR,
    );
    expect(r).toEqual({ added: 1, skipped: ['00:1A:2B:3C:4D:41'] });
    expect(t.created).toEqual([
      {
        name: 'PC-42',
        mac: '00:1A:2B:3C:4D:42',
        ip: '10.0.3.42',
        hostname: 'LAB3-PC42',
        roomId: 3,
      },
    ]);
    expect((await t.service.status()).found.every((f) => f.registered !== null)).toBe(true);
    expect(
      t.service.add(
        { roomId: 3, devices: [{ mac: '00:1A:2B:3C:4D:42', ip: '10.0.3.42', name: 'PC-42' }] },
        ACTOR,
      ),
    ).toEqual({ added: 0, skipped: ['00:1A:2B:3C:4D:42'] });
  });

  it('keeps first-seen across sweeps and returns the running sweep instead of starting another', async () => {
    const t = setup();
    t.setNeighbors([n('10.0.3.42', '00:1A:2B:3C:4D:42')]);
    await t.service.scan({ cidr: '10.0.3.0/24' }, ACTOR);
    await t.done();
    t.clock.advance(3_600_000);
    const first = t.service.scan({ cidr: '10.0.3.0/24' }, ACTOR);
    const again = await t.service.scan({ cidr: '10.0.3.0/24' }, ACTOR);
    expect(again.state).toBe('running');
    await first;
    const s = await t.done();
    expect(s.found[0]).toMatchObject({ firstSeenAt: T0, lastSeenAt: T0 + 3_600_000 });
    expect(t.audits().filter((a) => a.action === 'discovery.scan')).toHaveLength(2);
  });
});

describe('discovery routes (FR-101)', () => {
  it('operators sweep, read the results and add machines to a room; the routes need a session', async () => {
    const { apiHarness } = await import('./helpers/api');
    const h = await apiHarness();
    try {
      const cookie = await h.as('operator');
      const room = h.services.rooms.create({ name: 'Lab 3' }, { id: null, label: 'teste' });
      h.ports.neighbors.entries = [n('10.0.3.42', '00:1A:2B:3C:4D:42')];
      expect((await h.inject({ url: '/api/discovery' })).statusCode).toBe(401);
      const started = await h.inject({
        method: 'POST',
        url: '/api/discovery/scan',
        cookie,
        payload: { cidr: '10.0.3.0/24' },
      });
      expect(started.statusCode).toBe(202);
      await vi.waitFor(async () =>
        expect(
          (await h.inject({ url: '/api/discovery', cookie })).json<DiscoveryState>().state,
        ).toBe('done'),
      );
      const s = (await h.inject({ url: '/api/discovery', cookie })).json<DiscoveryState>();
      expect(s.found.map((f) => f.mac)).toEqual(['00:1A:2B:3C:4D:42']);
      const add = await h.inject({
        method: 'POST',
        url: '/api/discovery/add',
        cookie,
        payload: {
          roomId: room.id,
          devices: [{ mac: '00:1A:2B:3C:4D:42', ip: '10.0.3.42', name: 'PC-42' }],
        },
      });
      expect(add.json()).toEqual({ added: 1, skipped: [] });
      const created = h.services.devices.list({ all: true, page: 1, pageSize: 50 }) as {
        name: string;
        roomId: number | null;
      }[];
      expect(created.map((d) => [d.name, d.roomId])).toEqual([['PC-42', room.id]]);
    } finally {
      await h.close();
    }
  });
});

describe('discovery in demo mode (FR-015, FR-101)', () => {
  it('the simulated network has unregistered machines that answer, show in the ARP cache and have names', async () => {
    const { SimulatedNetwork, DEMO_UNREGISTERED } =
      await import('../src/adapters/simulated-network');
    const sim = new SimulatedNetwork({
      clock: new FakeClock(T0),
      devices: () => [{ mac: '00:1A:2B:00:00:01', ip: '10.20.1.1', hostname: 'LAB1-PC01' }],
      random: () => 0.5,
      driftPerProbe: 0,
    });
    const extra = DEMO_UNREGISTERED[0]!;
    const probed = await sim.prober.probe([extra.ip!, '10.20.1.1'], {
      icmpTimeoutMs: 1,
      tcpPorts: [],
      tcpTimeoutMs: 1,
    });
    expect(probed.get(extra.ip!)?.alive).toBe(true);
    expect(probed.get('10.20.1.1')?.alive).toBe(false); // registered machines start off
    expect((await sim.neighbors.read()).map((x) => x.mac)).toEqual(
      DEMO_UNREGISTERED.map((d) => d.mac),
    );
    expect(await sim.dns.reverse!(extra.ip!)).toEqual(['sala-nova-pc01.demo.local']);
  });

  describe('M9 break-it', () => {
    it('M9-F1: the default gateway (a router) is not listed as a machine', async () => {
      const t = setup();
      t.setNeighbors([n('10.0.3.1', '00:1A:2B:3C:4D:01'), n('10.0.3.42', '00:1A:2B:3C:4D:42')]);
      await t.service.scan({ cidr: '10.0.3.0/24' }, ACTOR);
      expect((await t.done()).found.map((f) => f.ip)).toEqual(['10.0.3.42']);
    });

    it('M9-F2: bulk add is audited with the room name', () => {
      const t = setup();
      t.service.add(
        { roomId: 3, devices: [{ mac: '00:1A:2B:3C:4D:42', ip: '10.0.3.42', name: 'PC' }] },
        ACTOR,
      );
      expect(t.audits()[0]).toMatchObject({ action: 'discovery.add', target: 'room:Lab 3' });
    });
  });
});
