/**
 * M16-T03 (plan §15.3, ADR-048): migration 006 on a populated v1.2 database, the new schedule and
 * device fields travelling between two PCs, and PCs on different team protocol versions refusing
 * to sync (a v1.2 PC would read a shutdown schedule as a wake schedule).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type {
  MessageChannel,
  SyncEndpoint,
  SyncListenHandlers,
  SyncNetwork,
} from '../src/application/ports';
import { PROTOCOL_VERSION } from '../src/application/team/protocol';
import { VERSION_MISMATCH_MESSAGE } from '../src/application/team/sync-service';
import { teamHash } from '../src/application/team/team-service';
import { NodeSyncNetwork } from '../src/adapters/sync-network';
import { openMemoryDb, type Db } from '../src/db/connection';
import { MIGRATIONS, migrate } from '../src/db/migrate';
import { applyRemote, changesSince } from '../src/db/sync/apply';
import { baselineChangeLog, changeLog, verifyChangeLog } from '../src/db/sync/change-log';
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

const logged = <T>(db: Db, entity: string, uuid: string) =>
  JSON.parse(
    db.get<{ payload: string }>(
      'SELECT payload FROM change_log WHERE entity = ? AND entity_id = ?',
      [entity, uuid],
    )!.payload,
  ) as T;

describe('migration 006 on a populated v1.2 database', () => {
  it('keeps every row and identity, makes old schedules "Ligar" and re-logs the new shapes', () => {
    const db = openMemoryDb();
    migrate(
      db,
      MIGRATIONS.filter((m) => m.version <= 5),
      { now: () => T0 },
    );
    const SCHED = '11111111-1111-4111-8111-111111111111';
    const DEV = '22222222-2222-4222-8222-222222222222';
    const MEMBER = '33333333-3333-4333-8333-333333333333';
    const ROOM = '44444444-4444-4444-8444-444444444444';
    // As v1.2 left it: logged rows with revisions and the old snapshot shapes.
    db.exec(`
      INSERT INTO instance (id, instance_id, created_at, clock) VALUES (1, '${MEMBER}', 1, 9);
      INSERT INTO rooms (id, uuid, rev, updated_by_instance, name, code, color, created_at, updated_at)
        VALUES (1, '${ROOM}', 2, '${MEMBER}', 'Lab 1', 'LAB-1', '#2563eb', 1, 1);
      INSERT INTO devices (id, uuid, rev, updated_by_instance, name, mac, room_id, created_at, updated_at)
        VALUES (1, '${DEV}', 3, '${MEMBER}', 'PC-01', '00:11:22:33:44:01', 1, 1, 1);
      INSERT INTO schedules (id, uuid, rev, updated_by_instance, name, weekdays, time_local, timezone, created_at, updated_at)
        VALUES (1, '${SCHED}', 4, '${MEMBER}', 'Manhã', 31, '06:50', 'America/Sao_Paulo', 1, 1);
      INSERT INTO schedule_targets (schedule_id, type, ref_id, ref_uuid) VALUES (1, 'room', 1, '${ROOM}');
      INSERT INTO team_members (id, uuid, name, verifier, joined_at, rev, updated_by_instance)
        VALUES (1, '${MEMBER}', 'PC-A', 'abc', 1, 5, '${MEMBER}');
      INSERT INTO change_log (entity, entity_id, op, rev, instance_id, at, payload) VALUES
        ('room', '${ROOM}', 'upsert', 2, '${MEMBER}', 1, '{"old":true}'),
        ('device', '${DEV}', 'upsert', 3, '${MEMBER}', 1, '{"old":true}'),
        ('schedule', '${SCHED}', 'upsert', 4, '${MEMBER}', 1, '{"old":true}'),
        ('team_member', '${MEMBER}', 'upsert', 5, '${MEMBER}', 1, '{"old":true}');
    `);

    migrate(db, MIGRATIONS, { now: () => T0 });

    expect(
      db.get('SELECT action, warning_minutes, allow_postpone, exclude_tags FROM schedules'),
    ).toEqual({ action: 'wake', warning_minutes: null, allow_postpone: null, exclude_tags: '[]' });
    expect(db.get('SELECT never_scheduled_shutdown AS f FROM devices')).toEqual({ f: 0 });
    // Only the entities whose snapshot changed go back to rev 0; identities stay.
    expect(
      db.all('SELECT uuid, rev FROM schedules UNION ALL SELECT uuid, rev FROM devices'),
    ).toEqual([
      { uuid: SCHED, rev: 0 },
      { uuid: DEV, rev: 0 },
    ]);
    expect(db.get<{ rev: number }>('SELECT rev FROM rooms')!.rev).toBe(2);
    for (const t of [
      'device_agents',
      'power_jobs',
      'power_orders',
      'power_reports',
      'agent_seen',
      'hub_keys',
    ]) {
      expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n).toBe(0);
    }

    // The room keeps its old (fake) log row: rewrite it to the real snapshot as v1.2 had it.
    db.run("DELETE FROM change_log WHERE entity = 'room'");
    db.run('UPDATE rooms SET rev = 0');
    expect(baselineChangeLog(db)).toBe(4); // room + member + device + schedule
    expect(verifyChangeLog(db)).toEqual([]);
    expect(logged<Record<string, unknown>>(db, 'schedule', SCHED)).toMatchObject({
      name: 'Manhã',
      action: 'wake',
      warningMinutes: null,
      allowPostpone: null,
      postponeMax: null,
      postponeMinutes: null,
      excludeTags: [],
      targets: [{ type: 'room', ref: ROOM }],
    });
    expect(logged<Record<string, unknown>>(db, 'device', DEV)).toMatchObject({
      name: 'PC-01',
      neverScheduledShutdown: false,
    });
    expect(logged<Record<string, unknown>>(db, 'team_member', MEMBER)).toMatchObject({
      name: 'PC-A',
      signingKeyId: null,
      signingPublicKey: null,
    });
    expect(db.get<{ clock: number }>('SELECT clock FROM instance')!.clock).toBeGreaterThan(9);
  });
});

describe('shutdown fields between two PCs (ADR-048)', () => {
  function pc() {
    const db = testDb();
    const clock = new FakeClock(T0);
    const s = createServices(db, clock, fakePorts(clock));
    worlds.push(s);
    return { s, db, clock };
  }
  type Pc = ReturnType<typeof pc>;
  const pull = (to: Pc, from: Pc) =>
    applyRemote(to.db, changesSince(from.db, 0).entries, {
      now: to.clock.now(),
      peerAckedSeq: 0,
      peerInstance: from.s.health.details().instanceId,
    });

  it('a shutdown schedule with excluded tags and a protected device arrive unchanged', () => {
    const a = pc();
    const b = pc();
    const room = a.s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    const tag = a.s.tags.create({ name: 'professor' }, ACTOR).id;
    const dev = a.s.devices.create(
      { name: 'PROF', mac: '00:AA:00:00:00:01', roomId: room, tagIds: [tag] },
      ACTOR,
    ).device.id;
    const sched = a.s.schedules.create(
      {
        name: 'Noite',
        weekdays: 31,
        timeLocal: '22:40',
        target: { type: 'rooms', roomIds: [room] },
      },
      ACTOR,
    ).id;
    const tagUuid = changeLog(a.db).uuidOf('tag', tag)!;
    // The schedule API learns these fields in M17-T04; write them as the repository will.
    a.db.run(
      `UPDATE schedules SET action = 'shutdown', warning_minutes = 5, allow_postpone = 1,
         postpone_max = 2, postpone_minutes = 15, exclude_tags = ? WHERE id = ?`,
      [JSON.stringify([tagUuid]), sched],
    );
    changeLog(a.db).touch('schedule', sched);
    a.db.run('UPDATE devices SET never_scheduled_shutdown = 1 WHERE id = ?', [dev]);
    changeLog(a.db).touch('device', dev);

    pull(b, a);
    expect(
      b.db.get(
        `SELECT action, warning_minutes, allow_postpone, postpone_max, postpone_minutes, exclude_tags
         FROM schedules`,
      ),
    ).toEqual({
      action: 'shutdown',
      warning_minutes: 5,
      allow_postpone: 1,
      postpone_max: 2,
      postpone_minutes: 15,
      exclude_tags: JSON.stringify([tagUuid]),
    });
    expect(b.db.get('SELECT never_scheduled_shutdown AS f FROM devices')).toEqual({ f: 1 });
    // B logged A's versions as they are (no new local version, so nothing echoes back).
    const uuid = changeLog(a.db).uuidOf('schedule', sched)!;
    expect(logged(b.db, 'schedule', uuid)).toEqual(logged(a.db, 'schedule', uuid));
  });

  it('refuses a schedule with an unknown action and applies nothing of that batch', () => {
    const a = pc();
    const b = pc();
    const room = a.s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    a.s.schedules.create(
      {
        name: 'Noite',
        weekdays: 31,
        timeLocal: '22:40',
        target: { type: 'rooms', roomIds: [room] },
      },
      ACTOR,
    );
    const entries = changesSince(a.db, 0).entries.map((e) =>
      e.entity === 'schedule' ? { ...e, payload: { ...e.payload, action: 'restart' } } : e,
    );
    expect(() => applyRemote(b.db, entries, { now: T0, peerAckedSeq: 0 })).toThrow(
      /unknown schedule action/,
    );
    expect(b.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM rooms')!.n).toBe(0);
  });
});

describe('team protocol version (ADR-048, D9-12)', () => {
  /** Rewrites the protocol version of every message this PC sends (simulates an older PC). */
  class OldVersionNetwork implements SyncNetwork {
    constructor(
      private readonly inner: NodeSyncNetwork,
      public sendVersion: number | null = null,
    ) {}
    private rewrite(ch: MessageChannel): MessageChannel {
      return {
        remoteAddress: ch.remoteAddress,
        send: (m) =>
          ch.send(
            this.sendVersion !== null && typeof m === 'object' && m !== null && 'v' in m
              ? { ...m, v: this.sendVersion }
              : m,
          ),
        receive: (t) => ch.receive(t),
        close: () => ch.close(),
      };
    }
    listen(port: number, h: SyncListenHandlers) {
      return this.inner.listen(port, {
        onPairing: (ch) => h.onPairing(this.rewrite(ch)),
        pskFor: (id) => h.pskFor(id),
        onSync: (ch, id) => h.onSync(this.rewrite(ch), id),
      });
    }
    async connectPairing(to: SyncEndpoint, ms: number) {
      return this.rewrite(await this.inner.connectPairing(to, ms));
    }
    async connectSync(to: SyncEndpoint, id: string, psk: Buffer, ms: number) {
      return this.rewrite(await this.inner.connectSync(to, id, psk, ms));
    }
    listenAnnouncements(port: number, f: (m: unknown, from: string) => void) {
      return this.inner.listenAnnouncements(port, f);
    }
    announce(m: unknown, t: readonly SyncEndpoint[]) {
      return this.inner.announce(m, t);
    }
    close() {
      return this.inner.close();
    }
  }

  function world(name: string) {
    const db = testDb();
    const clock = new FakeClock(T0);
    const net = new OldVersionNetwork(new NodeSyncNetwork({ bind: '127.0.0.1' }));
    const s = createServices(
      db,
      clock,
      { ...fakePorts(clock), syncNetwork: net },
      {
        team: { port: 0, defaultPort: 0, machineName: name, announceTargets: () => [] },
      },
    );
    worlds.push(s);
    return { s, net };
  }
  async function paired() {
    const a = world('PC-A');
    const b = world('PC-B');
    const { code } = await a.s.pairing.openCode(ACTOR);
    await b.s.pairing.join(
      { address: '127.0.0.1', port: a.s.sync.ports().tcp!, code: code! },
      ACTOR,
    );
    return { a, b };
  }
  const memberStatus = (w: ReturnType<typeof world>, other: ReturnType<typeof world>) =>
    w.s.sync.status().members.find((m) => m.instanceId === other.s.team.self().instanceId)!;

  it('is 2 since v1.3', () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it('a hub answers a PC on another version with "version" and that PC shows "Versão diferente"', async () => {
    const { a, b } = await paired();
    b.net.sendVersion = 1;
    a.s.rooms.create({ name: 'Lab novo' }, ACTOR);
    await b.s.sync.syncAll(false);
    expect(memberStatus(b, a).lastError).toBe(VERSION_MISMATCH_MESSAGE);
    expect(b.s.rooms.list().map((r) => r.name)).not.toContain('Lab novo');
  }, 30_000);

  it('a member announcing another version is shown as "Versão diferente" and never pulled', async () => {
    const { a, b } = await paired();
    const bId = b.s.team.self().instanceId;
    a.s.sync.handleAnnouncement(
      { app: 'uniwake', v: 1, instance: bId, port: 1, team: teamHash(a.s.team.teamId()!), seq: 99 },
      '127.0.0.1',
    );
    expect(memberStatus(a, b).lastError).toBe(VERSION_MISMATCH_MESSAGE);
    b.s.rooms.create({ name: 'Lab de B' }, ACTOR);
    await a.s.sync.syncAll(false);
    expect(a.s.rooms.list().map((r) => r.name)).not.toContain('Lab de B');
    // Once it announces our version again, syncing resumes.
    a.s.sync.handleAnnouncement(b.s.sync.announcementMessage(), '127.0.0.1');
    await a.s.sync.syncAll(false);
    expect(a.s.rooms.list().map((r) => r.name)).toContain('Lab de B');
  }, 30_000);
});
