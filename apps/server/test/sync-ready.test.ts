/**
 * FR-017 sync-ready data (ADR-031..034): identity, change log, tombstones, machine settings, lease
 * and the migration of a populated v1.0 database.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SETTING_DEFS, SETTING_KEYS } from '@uniwake/shared';
import { Scheduler } from '../src/application/schedules/scheduler';
import { type Db, openMemoryDb } from '../src/db/connection';
import { MIGRATIONS, migrate } from '../src/db/migrate';
import { SqliteSchedulerRepo } from '../src/db/repositories/scheduler-repo';
import { baselineChangeLog, changeLog, verifyChangeLog } from '../src/db/sync/change-log';
import { ensureInstance, readInstance, rotateInstance } from '../src/db/sync/instance';
import { scheduleRunUuid, uuidV5 } from '../src/db/sync/uuid';
import { createServices, type Services } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { MemoryLogger } from './fakes/system-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sp = (day: number, h: number, m = 0, s = 0) => Date.UTC(2026, 9, day, h + 3, m, s);

interface LogRow {
  entity: string;
  entity_id: string;
  op: string;
  rev: number;
  instance_id: string;
  payload: string | null;
}
const logOf = (db: Db, entity: string) =>
  db.all<LogRow>('SELECT * FROM change_log WHERE entity = ? ORDER BY seq', [entity]);
const payload = <T>(r: LogRow | undefined) => JSON.parse(r!.payload!) as T;

const harnesses: ApiHarness[] = [];
const worlds: Services[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close(); // also runs verifyChangeLog (R6-01)
  for (const s of worlds.splice(0)) {
    s.scheduler.stop();
    s.db.close();
  }
});

async function api() {
  const h = await apiHarness();
  harnesses.push(h);
  const cookie = await h.as('admin');
  const call = async <T>(
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
  ) => {
    const r = await h.inject({ method, url, cookie, payload });
    if (r.statusCode >= 400) throw new Error(`${method} ${url}: ${r.statusCode} ${r.body}`);
    return (r.body ? r.json() : null) as T;
  };
  return { h, db: h.services.db, call };
}

describe('instance identity (ADR-033)', () => {
  it('AC-017-01: one UUID per installation, the same on every start, shown on the health page', async () => {
    const db = testDb();
    const a = ensureInstance(db, T0);
    const b = ensureInstance(db, T0 + 1000);
    expect(a.instanceId).toMatch(UUID);
    expect(b).toEqual(a);
    const s = createServices(db, new FakeClock(T0), fakePorts(new FakeClock(T0)));
    worlds.push(s);
    expect(s.health.details().instanceId).toBe(a.instanceId);
  });

  it('AC-017-08: a restore gives a new identity and keeps the clock at the highest revision', () => {
    const db = testDb();
    const log = changeLog(db);
    for (let i = 0; i < 3; i++) {
      const id = db.run("INSERT INTO tags (name, color) VALUES (?, '#123456')", [
        `t${i}`,
      ]).lastInsertRowid;
      log.touch('tag', id);
    }
    const before = readInstance(db)!;
    // A restored file: its clock was behind what its own log contains.
    db.run('UPDATE instance SET clock = 1');
    const after = rotateInstance(db, T0);
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(after.instanceId).toMatch(UUID);
    expect(after.clock).toBeGreaterThanOrEqual(3);
  });
});

describe('deterministic run identity (ADR-031 §2)', () => {
  it('AC-017-07: the same schedule and instant give the same UUID anywhere; another instant does not', () => {
    const s = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    expect(scheduleRunUuid(s, sp(5, 6, 50))).toBe(scheduleRunUuid(s, sp(5, 6, 50)));
    expect(scheduleRunUuid(s, sp(5, 6, 50))).not.toBe(scheduleRunUuid(s, sp(6, 6, 50)));
    expect(scheduleRunUuid(s, sp(5, 6, 50))).toMatch(UUID);
    // RFC 9562 test vector: v5("www.example.com", DNS namespace).
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
});

describe('change log through the API (ADR-031)', () => {
  it('AC-017-02: every replicated write leaves exactly one log row matching the row, refs as UUIDs', async () => {
    const { h, db, call } = await api();
    const room = await call<{ id: number }>('POST', '/api/rooms', { name: 'Lab 1' });
    await call('PATCH', `/api/rooms/${room.id}`, { name: 'Lab 1A', notes: 'segundo andar' });
    const tag = await call<{ id: number }>('POST', '/api/tags', { name: 'professor' });
    const dev = await call<{ device: { id: number } }>('POST', '/api/devices', {
      name: 'PC-01',
      mac: '00:11:22:33:44:01',
      roomId: room.id,
      tagIds: [tag.id],
    });
    await call('PATCH', `/api/devices/${dev.device.id}`, { hostname: 'pc-01' });
    await call('POST', '/api/schedules', {
      name: 'Manhã',
      weekdays: 31,
      timeLocal: '06:50',
      target: { type: 'rooms', roomIds: [room.id] },
    });
    await call('POST', '/api/schedule-exceptions', {
      scheduleId: null,
      startDate: '2026-11-20',
      endDate: '2026-11-20',
      description: 'Consciência Negra',
    });
    await call('POST', '/api/scheduler/pause', { reason: 'recesso' });
    await call('POST', '/api/scheduler/resume');
    await call('PATCH', '/api/settings', { 'wake.repeat': 4 });

    const instance = readInstance(db)!.instanceId;
    const rooms = db.all<{ uuid: string; rev: number; updated_by_instance: string }>(
      'SELECT uuid, rev, updated_by_instance FROM rooms',
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.uuid).toMatch(UUID);
    expect(rooms[0]!.updated_by_instance).toBe(instance);
    const roomLog = logOf(db, 'room');
    expect(roomLog).toHaveLength(1); // one row per entity, even after the edit
    expect(roomLog[0]!.rev).toBe(rooms[0]!.rev);
    expect(payload<{ name: string }>(roomLog[0]).name).toBe('Lab 1A');

    const tagUuid = db.get<{ uuid: string }>('SELECT uuid FROM tags')!.uuid;
    const device = payload<{ room: string; tags: string[] }>(logOf(db, 'device')[0]);
    expect(device.room).toBe(rooms[0]!.uuid);
    expect(device.tags).toEqual([tagUuid]);
    expect(JSON.stringify(device)).not.toContain(`"roomId"`);

    const schedule = payload<{ targets: { type: string; ref: string }[] }>(
      logOf(db, 'schedule')[0],
    );
    expect(schedule.targets).toEqual([{ type: 'room', ref: rooms[0]!.uuid }]);
    expect(logOf(db, 'schedule_exception')).toHaveLength(1);
    expect(payload<{ pause: unknown }>(logOf(db, 'scheduler_pause')[0]).pause).toBeNull();
    expect(logOf(db, 'setting').map((r) => r.entity_id)).toEqual(['wake.repeat']);
    expect(logOf(db, 'user').length).toBeGreaterThan(0);
    // Lock-out counters are machine-local: a failed login changes no snapshot.
    await h.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin-user', password: 'senha-errada-123' },
    });
    expect(verifyChangeLog(db)).toEqual([]);
  });

  it('AC-017-03: deletes leave tombstones; devices are re-logged without the room or tag', async () => {
    const { h, db, call } = await api();
    const room = await call<{ id: number }>('POST', '/api/rooms', { name: 'Lab 2' });
    const tag = await call<{ id: number }>('POST', '/api/tags', { name: 'servidor' });
    for (let i = 0; i < 3; i++) {
      await call('POST', '/api/devices', {
        name: `PC-${i}`,
        mac: `00:11:22:33:55:0${i}`,
        roomId: room.id,
        tagIds: [tag.id],
      });
    }
    const sched = await call<{ id: number }>('POST', '/api/schedules', {
      name: 'Manhã',
      weekdays: 127,
      timeLocal: '06:50',
      target: { type: 'tags', tagIds: [tag.id] },
    });
    h.services.schedules.createException(
      {
        scheduleId: sched.id,
        startDate: '2026-12-24',
        endDate: '2026-12-31',
        description: 'Recesso',
      },
      ACTOR,
    );
    new SqliteSchedulerRepo(db).claim(sched.id, sp(5, 6, 50), sp(5, 6, 50), 'executado', null);
    const roomUuid = db.get<{ uuid: string }>('SELECT uuid FROM rooms')!.uuid;
    const tagUuid = db.get<{ uuid: string }>('SELECT uuid FROM tags')!.uuid;

    await call('DELETE', `/api/rooms/${room.id}?confirm=true`);
    await call('DELETE', `/api/tags/${tag.id}?confirm=true`);
    const op = (entity: string, id: string) =>
      db.get<{ op: string }>('SELECT op FROM change_log WHERE entity = ? AND entity_id = ?', [
        entity,
        id,
      ])?.op;
    expect(op('room', roomUuid)).toBe('delete');
    expect(op('tag', tagUuid)).toBe('delete');
    for (const r of logOf(db, 'device')) {
      expect(payload<{ room: unknown; tags: unknown[] }>(r)).toMatchObject({
        room: null,
        tags: [],
      });
    }
    // The schedule keeps the deleted tag's UUID; its local id is gone (ADR-031 §8).
    expect(db.get('SELECT ref_id, ref_uuid FROM schedule_targets')).toEqual({
      ref_id: null,
      ref_uuid: tagUuid,
    });

    const schedUuid = db.get<{ uuid: string }>('SELECT uuid FROM schedules')!.uuid;
    const excUuid = db.get<{ uuid: string }>('SELECT uuid FROM schedule_exceptions')!.uuid;
    const runUuid = db.get<{ uuid: string }>('SELECT uuid FROM schedule_runs')!.uuid;
    expect(runUuid).toBe(scheduleRunUuid(schedUuid, sp(5, 6, 50)));
    await call('DELETE', `/api/schedules/${sched.id}`);
    expect([
      op('schedule', schedUuid),
      op('schedule_exception', excUuid),
      op('schedule_run', runUuid),
    ]).toEqual(['delete', 'delete', 'delete']);
    const { device } = await call<{ device: { id: number } }>('POST', '/api/devices', {
      name: 'PC-X',
      mac: '00:11:22:33:55:99',
    });
    await call('DELETE', `/api/devices/${device.id}`);
    expect(logOf(db, 'device').filter((r) => r.op === 'delete')).toHaveLength(1);
    expect(verifyChangeLog(db)).toEqual([]);
  });

  it('AC-017-05: machine settings go to machine_settings and are never logged; shared ones are', async () => {
    const { db, call } = await api();
    await call('PATCH', '/api/settings', {
      'wake.interfaces': ['10.0.0.5'],
      'update.windowStart': '01:00',
      'monitor.intervalSeconds': 120,
    });
    expect(db.all('SELECT key FROM machine_settings ORDER BY key')).toEqual([
      { key: 'update.windowStart' },
      { key: 'wake.interfaces' },
    ]);
    expect(db.all('SELECT key FROM settings')).toEqual([{ key: 'monitor.intervalSeconds' }]);
    expect(logOf(db, 'setting').map((r) => r.entity_id)).toEqual(['monitor.intervalSeconds']);
  });
});

describe('settings scope (ADR-032)', () => {
  it('AC-017-09: every setting declares a scope; network, panel, update and backup keys are machine', () => {
    const machine = SETTING_KEYS.filter((k) => SETTING_DEFS[k].meta.scope === 'machine');
    for (const k of SETTING_KEYS)
      expect(['shared', 'machine']).toContain(SETTING_DEFS[k].meta.scope);
    expect(machine).toEqual(
      expect.arrayContaining([
        'wake.interfaces',
        'panel.lanEnabled',
        'panel.lanAddress',
        'enrollment.hubAddress',
        'update.mode',
        'backup.time',
        'bootstrap.panelPort',
      ]),
    );
    expect(machine).not.toContain('wake.repeat');
    expect(machine).not.toContain('scheduler.graceMinutes');
  });
});

describe('execution lease (ADR-034)', () => {
  function world(lease: { shouldHandle: () => boolean }) {
    const db = testDb();
    const clock = new FakeClock(T0);
    const s = createServices(db, clock, fakePorts(clock));
    worlds.push(s);
    const room = s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    s.devices.create(
      { name: 'PC-1', mac: '00:DD:00:00:00:01', roomId: room, ip: '10.0.3.10' },
      ACTOR,
    );
    s.schedules.create(
      {
        name: 'Manhã',
        weekdays: 31,
        timeLocal: '06:50',
        target: { type: 'rooms', roomIds: [room] },
      },
      ACTOR,
    );
    const asked: unknown[] = [];
    const scheduler = new Scheduler({
      repo: new SqliteSchedulerRepo(db),
      lease: {
        shouldHandle: (o) => {
          asked.push(o);
          return lease.shouldHandle();
        },
      },
      refs: { room: () => true, tag: () => true, device: () => true },
      startWake: (req, actor, opts) => s.wake.start(req, actor, opts),
      settings: s.settings,
      audit: s.audit,
      clock,
      events: s.events,
      logger: new MemoryLogger(),
      transaction: (fn) => db.transaction(fn),
    });
    return { db, clock, scheduler, asked };
  }

  it('AC-017-06: a declining lease leaves no run and no job; the solo lease runs and records who claimed', () => {
    const no = world({ shouldHandle: () => false });
    no.clock.set(sp(5, 6, 49));
    no.scheduler.tick();
    no.clock.set(sp(5, 6, 50, 5));
    expect(no.scheduler.tick()).toEqual({ ran: 0, logged: 0 });
    expect(no.db.all('SELECT * FROM schedule_runs')).toEqual([]);
    expect(no.db.all('SELECT * FROM wake_jobs')).toEqual([]);
    expect(no.asked[0]).toMatchObject({
      plannedAt: sp(5, 6, 50),
      scheduleUuid: expect.stringMatching(UUID),
    });

    const yes = world({ shouldHandle: () => true });
    yes.clock.set(sp(5, 6, 49));
    yes.scheduler.tick();
    yes.clock.set(sp(5, 6, 50, 5));
    expect(yes.scheduler.tick().ran).toBe(1);
    expect(yes.db.get('SELECT claimed_by_instance AS c FROM schedule_runs')).toEqual({
      c: readInstance(yes.db)!.instanceId,
    });
    expect(verifyChangeLog(yes.db)).toEqual([]);
  });
});

describe('schedule targets survive id reuse (ADR-031 §8)', () => {
  it('AC-005-12: a schedule on a deleted room never targets a room created with the same id', async () => {
    const { h, call } = await api();
    await call('POST', '/api/rooms', { name: 'Lab 1' });
    const r2 = await call<{ id: number }>('POST', '/api/rooms', { name: 'Lab 2' });
    const sched = await call<{ id: number }>('POST', '/api/schedules', {
      name: 'Lab 2 cedo',
      weekdays: 31,
      timeLocal: '06:50',
      target: { type: 'rooms', roomIds: [r2.id] },
    });
    h.services.rooms.delete(r2.id, true, ACTOR);
    const r3 = await call<{ id: number }>('POST', '/api/rooms', { name: 'Lab 3' });
    expect(r3.id).toBe(r2.id); // SQLite reused the highest rowid
    await call('POST', '/api/devices', { name: 'PC-3', mac: '00:11:22:33:66:01', roomId: r3.id });
    expect(h.services.schedules.get(sched.id)).toMatchObject({ emptyTarget: true, targetCount: 0 });
  });
});

describe('migration 004 on a populated v1.0 database (D6-01)', () => {
  it('AC-017-04: keeps every room, device, tag, schedule and setting and makes them syncable', () => {
    const db = openMemoryDb();
    migrate(
      db,
      MIGRATIONS.filter((m) => m.version <= 3),
      { now: () => T0 },
    );
    // Data as v1.0 wrote it (no UUIDs, no change log).
    db.exec(`
      INSERT INTO rooms (id, name, code, color, created_at, updated_at) VALUES
        (1, 'Lab 1', 'LAB-1', '#2563eb', 1, 1), (2, 'Lab 2', 'LAB-2', '#16a34a', 1, 1);
      INSERT INTO tags (id, name, color) VALUES (1, 'professor', '#f59e0b');
      INSERT INTO devices (id, name, mac, ip, room_id, created_at, updated_at) VALUES
        (1, 'PC-01', '00:11:22:33:44:01', '10.0.1.11', 1, 1, 1),
        (2, 'PC-02', '00:11:22:33:44:02', NULL, 2, 1, 1),
        (3, 'PROF', '00:11:22:33:44:03', '10.0.1.99', NULL, 1, 1);
      INSERT INTO device_tags (device_id, tag_id) VALUES (3, 1);
      INSERT INTO users (id, username, password_hash, role, created_at, password_changed_at)
        VALUES (1, 'admin', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'admin', 1, 1);
      INSERT INTO schedules (id, name, weekdays, time_local, timezone, created_by, created_at, updated_at)
        VALUES (1, 'Manhã', 31, '06:50', 'America/Sao_Paulo', 1, 1, 1);
      INSERT INTO schedule_targets (schedule_id, type, ref_id) VALUES (1, 'room', 1), (1, 'tag', 1);
      INSERT INTO schedule_exceptions (schedule_id, start_date, end_date, description)
        VALUES (NULL, '2026-11-20', '2026-11-20', 'Consciência Negra');
      INSERT INTO schedule_runs (schedule_id, planned_at, claimed_at, status) VALUES (1, 100, 100, 'executado');
      INSERT INTO settings (key, value, updated_at) VALUES
        ('wake.repeat', '4', 1), ('wake.interfaces', '["10.0.1.5"]', 1), ('backup.time', '"01:30"', 1);
      INSERT INTO system_state (key, value) VALUES
        ('scheduler.pause', '{"since":5,"reason":"recesso","resumeAt":null,"by":"admin"}');
    `);
    const count = (t: string) => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
    const tables = [
      'rooms',
      'tags',
      'devices',
      'device_tags',
      'users',
      'schedules',
      'schedule_targets',
      'schedule_exceptions',
      'schedule_runs',
    ];
    const before = Object.fromEntries(tables.map((t) => [t, count(t)]));

    migrate(db, MIGRATIONS, { now: () => T0 });
    expect(Object.fromEntries(tables.map((t) => [t, count(t)]))).toEqual(before);
    expect(db.all('SELECT key, value FROM machine_settings ORDER BY key')).toEqual([
      { key: 'backup.time', value: '"01:30"' },
      { key: 'wake.interfaces', value: '["10.0.1.5"]' },
    ]);
    expect(db.all('SELECT key, value FROM settings')).toEqual([{ key: 'wake.repeat', value: '4' }]);
    expect(verifyChangeLog(db).length).toBeGreaterThan(0); // not yet logged

    const logged = baselineChangeLog(db);
    // 2 rooms + 1 tag + 3 devices + 1 user + 1 schedule + 1 exception + 1 run + 1 setting + pause
    expect(logged).toBe(12);
    expect(verifyChangeLog(db)).toEqual([]);
    expect(baselineChangeLog(db)).toBe(0); // idempotent
    const room1 = db.get<{ uuid: string }>('SELECT uuid FROM rooms WHERE id = 1')!.uuid;
    const tag1 = db.get<{ uuid: string }>('SELECT uuid FROM tags WHERE id = 1')!.uuid;
    expect(payload<{ targets: unknown }>(logOf(db, 'schedule')[0]).targets).toEqual([
      { type: 'room', ref: room1 },
      { type: 'tag', ref: tag1 },
    ]);
    expect(payload<{ createdBy: string }>(logOf(db, 'schedule')[0]).createdBy).toBe(
      db.get<{ uuid: string }>('SELECT uuid FROM users')!.uuid,
    );
    expect(
      payload<{ pause: { reason: string } }>(logOf(db, 'scheduler_pause')[0]).pause.reason,
    ).toBe('recesso');
    // The populated rows still read the same through the services.
    const clock = new FakeClock(T0);
    const s = createServices(db, clock, fakePorts(clock));
    worlds.push(s);
    expect(s.rooms.list().map((r) => r.name)).toEqual(['Lab 1', 'Lab 2']);
    expect(s.settings.get('wake.interfaces')).toEqual(['10.0.1.5']);
    expect(s.settings.get('backup.time')).toBe('01:30');
    expect(s.settings.get('wake.repeat')).toBe(4);
  });
});

describe('M10 break-it', () => {
  it('a failure while logging rolls the write back with it (D6-02)', () => {
    const db = testDb();
    const clock = new FakeClock(T0);
    const s = createServices(db, clock, fakePorts(clock));
    worlds.push(s);
    const original = db.run.bind(db);
    db.run = (sql, params) => {
      if (sql.includes('INSERT INTO change_log')) throw new Error('disk I/O error');
      return original(sql, params);
    };
    expect(() => s.rooms.create({ name: 'Lab 9' }, ACTOR)).toThrow('disk I/O error');
    db.run = original;
    expect(db.all('SELECT * FROM rooms')).toEqual([]);
    expect(db.all('SELECT * FROM audit_log')).toEqual([]);
    expect(verifyChangeLog(db)).toEqual([]);
  });

  it('touching a row that does not exist and tombstoning a never-logged row are no-ops', () => {
    const db = testDb();
    changeLog(db).touch('room', 999);
    const id = db.run("INSERT INTO tags (name, color) VALUES ('x', '#000000')").lastInsertRowid;
    changeLog(db).tombstone('tag', id);
    expect(db.all('SELECT * FROM change_log')).toEqual([]);
  });

  it('the Lamport clock only moves forward, across entities and deletes', () => {
    const db = testDb();
    const log = changeLog(db);
    const id = db.run("INSERT INTO tags (name, color) VALUES ('x', '#000000')").lastInsertRowid;
    log.touch('tag', id);
    log.touch('tag', id);
    const r1 = db.get<{ rev: number }>('SELECT rev FROM change_log')!.rev;
    log.tombstone('tag', id);
    const r2 = db.get<{ rev: number; op: string }>('SELECT rev, op FROM change_log')!;
    expect(r1).toBe(2);
    expect(r2).toEqual({ rev: 3, op: 'delete' });
    expect(readInstance(db)!.clock).toBe(3);
  });
});
