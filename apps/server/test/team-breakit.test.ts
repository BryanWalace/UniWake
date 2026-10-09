/** M11-D / M12-D break-it regressions for Modo equipe (loopback only, fake clocks). */
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSyncNetwork } from '../src/adapters/sync-network';
import { applyRemote, changesSince } from '../src/db/sync/apply';
import { verifyChangeLog } from '../src/db/sync/change-log';
import { createServices, type Services } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const worlds: Services[] = [];
afterEach(async () => {
  for (const s of worlds.splice(0)) {
    expect(verifyChangeLog(s.db)).toEqual([]);
    s.scheduler.stop();
    await s.sync.close();
    s.db.close();
  }
});

function world(name: string) {
  const db = testDb();
  const clock = new FakeClock(T0);
  const ports = { ...fakePorts(clock), syncNetwork: new NodeSyncNetwork({ bind: '127.0.0.1' }) };
  const s = createServices(db, clock, ports, {
    team: { port: 0, defaultPort: 0, machineName: name, announceTargets: () => [] },
  });
  worlds.push(s);
  return { s, clock, db };
}
type World = ReturnType<typeof world>;
const port = (w: World) => w.s.sync.ports().tcp!;
async function pair(a: World, b: World) {
  const { code } = await a.s.pairing.openCode(ACTOR);
  await b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: code! }, ACTOR);
}
const id = (w: World) => w.s.team.self().instanceId;

describe('M12 break-it: sync', () => {
  it('a change gossips through a PC in the middle (A ↔ B ↔ C, A never talks to C)', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    const c = world('PC-C');
    await pair(a, b);
    await pair(b, c);
    // A is unreachable for C and vice versa.
    c.s.team.updatePeer({ instanceId: id(a), port: 1, address: '127.0.0.1' });
    a.s.rooms.create({ name: 'Só no A' }, ACTOR);
    await b.s.sync.pullFrom(id(a));
    await c.s.sync.pullFrom(id(b));
    expect(c.s.rooms.list().map((r) => r.name)).toEqual(['Só no A']);
    // The version kept A's identity and revision on the way (it is not B's own write).
    const row = c.db.get<{ instance_id: string }>(
      "SELECT instance_id FROM change_log WHERE entity = 'room'",
    )!;
    expect(row.instance_id).toBe(id(a));
  }, 30_000);

  it('the same version arriving from two peers is applied once', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    a.s.rooms.create({ name: 'Lab 1' }, ACTOR);
    const { entries } = changesSince(a.db, 0);
    expect(applyRemote(b.db, entries, { now: T0 }).applied).toBe(entries.length);
    expect(applyRemote(b.db, entries, { now: T0, peerInstance: 'another' }).applied).toBe(0);
    expect(b.s.rooms.list()).toHaveLength(1);
  });

  it('a large first sync (2 000 devices) applies in one go within a few seconds', () => {
    const a = world('PC-A');
    const b = world('PC-B');
    const room = a.s.rooms.create({ name: 'Grande' }, ACTOR).id;
    a.db.transaction(() => {
      for (let i = 0; i < 2000; i++) {
        a.s.devices.create(
          {
            name: `PC-${i}`,
            mac: `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
            roomId: room,
          },
          ACTOR,
        );
      }
    });
    const { entries } = changesSince(a.db, 0);
    const t = performance.now();
    applyRemote(b.db, entries, { now: T0 });
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(b.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')!.n).toBe(2000);
  }, 60_000);

  it('spoofed pairing announcements cannot grow the discovered list beyond 20', async () => {
    const a = world('PC-A');
    const udp = await a.s.sync.ensureUdp();
    const sender = new NodeSyncNetwork({ bind: '127.0.0.1' });
    for (let i = 0; i < 40; i++) {
      await sender.announce(
        {
          app: 'uniwake',
          v: 1,
          instance: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          port: 47102,
          seq: 0,
          pairing: { name: `X${i}` },
        },
        [{ host: '127.0.0.1', port: udp }],
      );
    }
    await new Promise((r) => setTimeout(r, 300));
    await sender.close();
    expect(a.s.sync.discoveredPairing().length).toBeLessThanOrEqual(20);
  }, 30_000);
});

describe('M11 break-it: pairing', () => {
  it('an open code is announced every 15 s, so the joiner can pick the PC from the list', async () => {
    const listener = new NodeSyncNetwork({ bind: '127.0.0.1' });
    const seen: unknown[] = [];
    const udp = await listener.listenAnnouncements(0, (m) => seen.push(m));
    const db = testDb();
    const clock = new FakeClock(T0);
    const s = createServices(
      db,
      clock,
      { ...fakePorts(clock), syncNetwork: new NodeSyncNetwork({ bind: '127.0.0.1' }) },
      {
        team: {
          port: 0,
          defaultPort: 0,
          machineName: 'PC-A',
          announceTargets: () => [{ host: '127.0.0.1', port: udp }],
        },
      },
    );
    worlds.push(s);
    await s.pairing.openCode(ACTOR);
    const pairing = () => seen.filter((m) => (m as { pairing?: unknown }).pairing).length;
    for (let i = 0; i < 100 && pairing() < 1; i++) await new Promise((r) => setTimeout(r, 20));
    const first = pairing();
    await clock.advanceAsync(15_000);
    for (let i = 0; i < 100 && pairing() <= first; i++) await new Promise((r) => setTimeout(r, 20));
    expect(pairing()).toBeGreaterThan(first);
    expect(seen.at(-1)).toMatchObject({ pairing: { name: 'PC-A' } });
    await listener.close();
  }, 30_000);

  it('a PC already in a team cannot join another one', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    const c = world('PC-C');
    await pair(a, b);
    const { code } = await c.s.pairing.openCode(ACTOR);
    await expect(
      b.s.pairing.join({ address: '127.0.0.1', port: port(c), code: code! }, ACTOR),
    ).rejects.toMatchObject({
      code: 'TEAM_ALREADY_MEMBER',
    });
  }, 30_000);

  it('garbage and a connection dropped mid-exchange leave the code usable', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    const { code } = await a.s.pairing.openCode(ACTOR);
    // Garbage on the pairing port.
    for (const payload of ['{"type":"pair.hello"}\n', '{not json\n', `${'x'.repeat(100)}\n`]) {
      const s = net.connect({ host: '127.0.0.1', port: port(a) });
      await new Promise((r) => s.once('connect', r));
      s.write(payload);
      await new Promise((r) => setTimeout(r, 50));
      s.destroy();
    }
    // A joiner that says hello and disappears.
    const half = net.connect({ host: '127.0.0.1', port: port(a) });
    await new Promise((r) => half.once('connect', r));
    half.write(
      `${JSON.stringify({ type: 'pair.hello', v: 1, instance: '11111111-1111-4111-8111-111111111111', name: 'X', nonce: 'AAAA' })}\n`,
    );
    await new Promise((r) => setTimeout(r, 50));
    half.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect(a.s.pairing.view()).toMatchObject({ open: true, attemptsLeft: 5 });
    await b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: code! }, ACTOR);
    expect(b.s.team.inTeam()).toBe(true);
  }, 30_000);

  it('the pairing port answers nothing useful when no code is open', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    await a.s.pairing.openCode(ACTOR);
    a.s.pairing.cancel();
    await expect(
      b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: '123456' }, ACTOR),
    ).rejects.toMatchObject({
      code: 'TEAM_PAIRING_NO_CODE',
    });
    expect(b.s.team.inTeam()).toBe(false);
  }, 30_000);
});
