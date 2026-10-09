/**
 * Team services on loopback (FR-201..204): code lifecycle, what travels, secrets at rest, status,
 * tombstone pruning, the execution lease and missed runs. Real TCP/TLS on 127.0.0.1, fake clocks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type {
  MessageChannel,
  SyncEndpoint,
  SyncListenHandlers,
  SyncNetwork,
} from '../src/application/ports';
import { FALLBACK_MS, TeamLease } from '../src/application/team/team-lease';
import { NodeSyncNetwork } from '../src/adapters/sync-network';
import { verifyChangeLog } from '../src/db/sync/change-log';
import { createServices, type Services } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const sp = (h: number, m = 0, s = 0) => Date.UTC(2026, 9, 5, h + 3, m, s);

/** Records every message either side sends (AC-201-02: the code never travels). */
class TappedNetwork implements SyncNetwork {
  readonly wire: string[] = [];
  constructor(private readonly inner: NodeSyncNetwork) {}
  private tap(ch: MessageChannel): MessageChannel {
    return {
      remoteAddress: ch.remoteAddress,
      send: (m) => {
        this.wire.push(JSON.stringify(m));
        ch.send(m);
      },
      receive: async (t) => {
        const m = await ch.receive(t);
        this.wire.push(JSON.stringify(m));
        return m;
      },
      close: () => ch.close(),
    };
  }
  listen(port: number, h: SyncListenHandlers) {
    return this.inner.listen(port, {
      onPairing: (ch) => h.onPairing(this.tap(ch)),
      pskFor: (id) => h.pskFor(id),
      onSync: (ch, id) => h.onSync(this.tap(ch), id),
    });
  }
  async connectPairing(to: SyncEndpoint, ms: number) {
    return this.tap(await this.inner.connectPairing(to, ms));
  }
  async connectSync(to: SyncEndpoint, id: string, psk: Buffer, ms: number) {
    return this.tap(await this.inner.connectSync(to, id, psk, ms));
  }
  listenAnnouncements(port: number, f: (m: unknown, from: string) => void) {
    return this.inner.listenAnnouncements(port, f);
  }
  announce(m: unknown, t: readonly SyncEndpoint[]) {
    this.wire.push(JSON.stringify(m));
    return this.inner.announce(m, t);
  }
  close() {
    return this.inner.close();
  }
}

const worlds: Services[] = [];
afterEach(async () => {
  for (const s of worlds.splice(0)) {
    expect(verifyChangeLog(s.db)).toEqual([]);
    s.scheduler.stop();
    await s.sync.close();
    s.db.close();
  }
});

function world(name: string, start = T0) {
  const db = testDb();
  const clock = new FakeClock(start);
  const net = new TappedNetwork(new NodeSyncNetwork({ bind: '127.0.0.1' }));
  const ports = { ...fakePorts(clock), syncNetwork: net };
  const s = createServices(db, clock, ports, {
    team: { port: 0, defaultPort: 0, machineName: name },
  });
  worlds.push(s);
  return { s, clock, db, net };
}
type World = ReturnType<typeof world>;

const port = (w: World) => w.s.sync.ports().tcp!;
async function until(cond: () => boolean, what: string) {
  const end = Date.now() + 5000;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function pair(a: World, b: World) {
  const { code } = await a.s.pairing.openCode(ACTOR);
  await b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: code! }, ACTOR);
}

describe('pairing code (FR-201.1)', () => {
  it('AC-201-01: 6 digits, 5 minutes, single use, a new code cancels the old, 5 misses lock it', async () => {
    const a = world('PC-A');
    const v = await a.s.pairing.openCode(ACTOR);
    expect(v.code).toMatch(/^\d{6}$/);
    expect(v.expiresAt).toBe(T0 + 5 * 60_000);
    const second = await a.s.pairing.openCode(ACTOR);
    a.clock.advance(5 * 60_000);
    expect(a.s.pairing.view().open).toBe(false); // expired

    const b = world('PC-B');
    await a.s.pairing.openCode(ACTOR);
    const code = a.s.pairing.view().code!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      await expect(
        b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: wrong }, ACTOR),
      ).rejects.toMatchObject({
        code: 'TEAM_PAIRING_WRONG_CODE',
      });
    }
    await expect(
      b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: wrong }, ACTOR),
    ).rejects.toMatchObject({
      code: 'TEAM_PAIRING_LOCKED',
    });
    // Locked: even the right code no longer works.
    await expect(
      b.s.pairing.join({ address: '127.0.0.1', port: port(a), code }, ACTOR),
    ).rejects.toMatchObject({
      code: 'TEAM_PAIRING_NO_CODE',
    });
    expect(second.code).not.toBeNull();

    const fresh = (await a.s.pairing.openCode(ACTOR)).code!;
    await b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: fresh }, ACTOR);
    const c = world('PC-C');
    await expect(
      c.s.pairing.join({ address: '127.0.0.1', port: port(a), code: fresh }, ACTOR),
    ).rejects.toMatchObject({
      code: 'TEAM_PAIRING_NO_CODE', // single use
    });
  }, 30_000);

  it('AC-201-02: the code never appears on the wire; a wrong code stores nothing anywhere', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    const { code } = await a.s.pairing.openCode(ACTOR);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(
      b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: wrong }, ACTOR),
    ).rejects.toThrow();
    expect(b.s.team.inTeam()).toBe(false);
    expect(b.db.all('SELECT * FROM team')).toEqual([]);
    await b.s.pairing.join({ address: '127.0.0.1', port: port(a), code: code! }, ACTOR);
    for (const msg of [...a.net.wire, ...b.net.wire]) {
      expect(msg).not.toContain(code!);
      expect(msg).not.toContain(wrong);
    }
    expect(a.net.wire.length).toBeGreaterThan(4);
  }, 30_000);

  it('AC-201-04: keys and member secrets are stored only as protected blobs', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    await pair(a, b);
    for (const w of [a, b]) {
      const row = w.db.get<{ key_blob: Uint8Array; member_secret_blob: Uint8Array }>(
        'SELECT * FROM team',
      )!;
      const key = Buffer.from(w.s.team.currentKeyB64().key, 'base64');
      expect(Buffer.from(row.key_blob).includes(key)).toBe(false);
      expect(Buffer.from(row.member_secret_blob).includes(w.s.team.memberSecret())).toBe(false);
      expect(Buffer.from(row.key_blob).subarray(0, 6).toString()).toBe('UWDEV1'); // the protector's output
      const logs = JSON.stringify((w.s as unknown as { db: unknown }) && fakeLogsOf(w));
      expect(logs).not.toContain(key.toString('base64'));
    }
  }, 30_000);
});

function fakeLogsOf(w: World): unknown {
  return w.s.audit.query({}).items;
}

describe('what travels and status (FR-202)', () => {
  it('AC-202-03: an announcement carries only the listed fields and a hash of the team id', async () => {
    const a = world('PC-A');
    await a.s.pairing.openCode(ACTOR);
    const msg = a.s.sync.announcementMessage();
    expect(Object.keys(msg).sort()).toEqual([
      'app',
      'instance',
      'pairing',
      'port',
      'seq',
      'team',
      'v',
    ]);
    expect(msg.team).not.toBe(a.s.team.teamId());
    expect(JSON.stringify(msg)).not.toContain(a.s.team.teamId()!);
    expect(msg.pairing).toEqual({ name: 'PC-A' });
    a.s.pairing.cancel();
    expect('pairing' in a.s.sync.announcementMessage()).toBe(false);
  });

  it('AC-202-07: pending changes while a PC is off; "Sincronizar agora" brings them to zero', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    await pair(a, b);
    await a.s.sync.syncAll(true);
    const bId = b.s.team.self().instanceId;
    const realPort = port(b);
    a.s.team.updatePeer({ instanceId: bId, port: 1 }); // B unreachable
    a.s.rooms.create({ name: 'Lab novo' }, ACTOR);
    await a.s.sync.syncAll(true);
    const pending = () => a.s.sync.status().members.find((m) => m.instanceId === bId)!;
    expect(pending().pending).toBeGreaterThan(0);
    a.s.team.updatePeer({ instanceId: bId, port: realPort });
    await b.s.sync.syncAll(false); // B pulls, then acknowledges what it applied
    await until(() => pending().pending === 0, 'pending to reach zero');
    expect(b.s.rooms.list().map((r) => r.name)).toContain('Lab novo');
  }, 30_000);

  it('AC-202-05: a tombstone is pruned only after every member acknowledged it and 30 days passed', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    await pair(a, b);
    const room = a.s.rooms.create({ name: 'Temporária' }, ACTOR).id;
    a.s.rooms.delete(room, true, ACTOR);
    const tombstones = () =>
      a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE op = 'delete'")!.n;
    expect(tombstones()).toBe(1);
    a.clock.advance(31 * 86_400_000);
    expect(a.s.sync.pruneTombstones()).toBe(0); // B has not acknowledged it yet
    await b.s.sync.syncAll(false);
    await until(() => a.s.sync.pruneTombstones() === 1, 'the tombstone to be pruned');
    expect(tombstones()).toBe(0);
  }, 30_000);
});

describe('team lease (FR-204, ADR-039)', () => {
  it('AC-204-03: the first candidate runs; the next takes over 90 s later', () => {
    const online: string[] = ['bbbbbbbb-0000-4000-8000-000000000000'];
    const lease = (self: string) =>
      new TeamLease({
        inTeam: () => true,
        self: () => self,
        online: () => online.filter((x) => x !== self),
      });
    const first = lease('aaaaaaaa-0000-4000-8000-000000000000');
    online.push('aaaaaaaa-0000-4000-8000-000000000000');
    const second = lease('bbbbbbbb-0000-4000-8000-000000000000');
    const at = sp(6, 50);
    expect(first.shouldHandle({ plannedAt: at, now: at + 1000 })).toBe(true);
    expect(second.shouldHandle({ plannedAt: at, now: at + 1000 })).toBe(false);
    expect(second.shouldHandle({ plannedAt: at, now: at + FALLBACK_MS })).toBe(true);
    // Alone (or not in a team), a PC always runs.
    expect(
      new TeamLease({ inTeam: () => true, self: () => 'z', online: () => [] }).shouldHandle({
        plannedAt: at,
        now: at,
      }),
    ).toBe(true);
    expect(
      new TeamLease({ inTeam: () => false, self: () => 'z', online: () => ['a'] }).shouldHandle({
        plannedAt: at,
        now: at,
      }),
    ).toBe(true);
  });

  it('AC-204-03: when the elected PC is on but does not run, the other runs once within 90 s', async () => {
    const a = world('PC-A', sp(6, 30));
    const b = world('PC-B', sp(6, 30));
    const lab = a.s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    a.s.devices.create(
      { name: 'PC-01', mac: '00:AA:00:00:00:01', ip: '10.0.3.11', roomId: lab },
      ACTOR,
    );
    a.s.schedules.create(
      {
        name: 'Manhã',
        weekdays: 31,
        timeLocal: '06:50',
        target: { type: 'rooms', roomIds: [lab] },
      },
      ACTOR,
    );
    await pair(a, b);
    const [elected, other] = [a, b].sort((x, y) =>
      x.s.team.self().instanceId < y.s.team.self().instanceId ? -1 : 1,
    );
    // The elected PC answers sync but its scheduler is stuck: only the other one ticks.
    for (const w of [a, b]) w.clock.set(sp(6, 49, 50));
    await other!.s.sync.syncAll(true);
    other!.s.scheduler.tick();
    for (const [t, expected] of [
      [sp(6, 50, 5), 0],
      [sp(6, 50, 45), 0],
      [sp(6, 51, 30), 1],
      [sp(6, 52, 0), 0],
    ] as const) {
      other!.clock.set(t);
      other!.s.team.updatePeer({
        instanceId: elected!.s.team.self().instanceId,
        lastSeenAt: t - 5000,
      });
      expect(other!.s.scheduler.tick().ran).toBe(expected);
    }
    expect(other!.db.get('SELECT status FROM schedule_runs')).toEqual({ status: 'executado' });
  }, 30_000);

  it('AC-204-04: a team PC that starts after a missed run offers it instead of waking by itself', async () => {
    const a = world('PC-A', sp(6, 30));
    const b = world('PC-B', sp(6, 30));
    const lab = a.s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    a.s.devices.create(
      { name: 'PC-01', mac: '00:AA:00:00:00:01', ip: '10.0.3.11', roomId: lab },
      ACTOR,
    );
    a.s.schedules.create(
      {
        name: 'Manhã',
        weekdays: 31,
        timeLocal: '06:50',
        target: { type: 'rooms', roomIds: [lab] },
      },
      ACTOR,
    );
    await pair(a, b);
    a.s.scheduler.tick(); // lastTick 06:30
    // A "restarts" at 06:55 (a new scheduler instance on the same database).
    const db = a.db;
    const clock = new FakeClock(sp(6, 55));
    const again = createServices(
      db,
      clock,
      { ...fakePorts(clock), syncNetwork: new NodeSyncNetwork({ bind: '127.0.0.1' }) },
      { team: { port: 0, defaultPort: 0 } },
    );
    await again.team.init();
    expect(again.scheduler.tick().ran).toBe(0);
    clock.set(sp(6, 56, 5));
    again.scheduler.tick();
    expect(db.all('SELECT * FROM wake_jobs')).toEqual([]);
    const notice = again.notices.list().find((n) => n.type === 'missed_run');
    expect(notice?.data).toMatchObject({ scheduleName: 'Manhã', plannedAt: sp(6, 50) });
    // "Ligar agora" wakes the schedule's target and closes the notice.
    const r = again.missedRuns.wakeNow(notice!.id, ACTOR);
    expect(r.jobId).toBeGreaterThan(0);
    expect(again.notices.list().some((n) => n.type === 'missed_run')).toBe(false);
    again.scheduler.stop();
    await again.sync.close();
  }, 30_000);
});
