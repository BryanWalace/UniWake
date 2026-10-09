/**
 * The apply engine between two databases (FR-202.3, FR-203, ADR-040): what A writes, B ends with,
 * the same way round on both sides, with the change log consistent on both.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type Db } from '../src/db/connection';
import { applyRemote, changesSince, replaceWithTeamState } from '../src/db/sync/apply';
import { changeLog, verifyChangeLog } from '../src/db/sync/change-log';
import { rowSnapshot, TABLE, type RowEntity } from '../src/db/sync/entities';
import { createServices, type Services } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const worlds: Services[] = [];
afterEach(() => {
  for (const s of worlds.splice(0)) {
    expect(verifyChangeLog(s.db)).toEqual([]);
    s.scheduler.stop();
    s.db.close();
  }
});

interface Pc {
  s: Services;
  db: Db;
  clock: FakeClock;
  /** Our cursor into the other PC's log. */
  cursor: Map<Pc, number>;
}
function pc(): Pc {
  const db = testDb();
  const clock = new FakeClock(T0);
  const s = createServices(db, clock, fakePorts(clock));
  worlds.push(s);
  return { s, db, clock, cursor: new Map() };
}

/** `to` pulls from `from` (FR-202.3); `from`'s ack of `to`'s log is `to`'s cursor into it. */
function pull(to: Pc, from: Pc) {
  const since = to.cursor.get(from) ?? 0;
  const { entries, seq } = changesSince(from.db, since);
  const r = applyRemote(to.db, entries, {
    now: to.clock.now(),
    peerAckedSeq: from.cursor.get(to) ?? 0,
    peerInstance: from.s.health.details().instanceId,
  });
  to.cursor.set(from, seq);
  return r;
}
const sync = (a: Pc, b: Pc) => {
  for (let i = 0; i < 3; i++) {
    pull(b, a);
    pull(a, b);
  }
};

/** Every replicated entity, keyed by UUID, as a peer would see it. */
function state(p: Pc) {
  const out: Record<string, unknown> = {};
  for (const entity of Object.keys(TABLE) as RowEntity[]) {
    for (const r of p.db.all<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM ${TABLE[entity]}`,
    )) {
      out[`${entity}/${r.uuid}`] = rowSnapshot(p.db, entity, r.id);
    }
  }
  for (const r of p.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    out[`setting/${r.key}`] = r.value;
  }
  return out;
}

function inventory(p: Pc, tag: string) {
  const room = p.s.rooms.create({ name: `Lab ${tag}` }, ACTOR).id;
  const t = p.s.tags.create({ name: `t-${tag}` }, ACTOR).id;
  const dev = p.s.devices.create(
    { name: `PC-${tag}`, mac: `00:AA:00:00:00:${tag}`, roomId: room, tagIds: [t] },
    ACTOR,
  ).device.id;
  const sched = p.s.schedules.create(
    {
      name: `Manhã ${tag}`,
      weekdays: 31,
      timeLocal: '06:50',
      target: { type: 'rooms', roomIds: [room] },
    },
    ACTOR,
  ).id;
  return { room, tag: t, dev, sched };
}

describe('apply engine', () => {
  it('AC-202-01: rooms, tags, devices and schedules from each PC end identical on both', () => {
    const a = pc();
    const b = pc();
    inventory(a, '01');
    inventory(b, '02');
    a.s.schedules.createException(
      { scheduleId: null, startDate: '2026-11-20', endDate: '2026-11-20', description: 'Feriado' },
      ACTOR,
    );
    sync(a, b);
    expect(state(a)).toEqual(state(b));
    expect(b.s.rooms.list().map((r) => r.name)).toEqual(['Lab 01', 'Lab 02']);
    // The device on B points at B's local ids for A's room and tag.
    const d = b.s.devices.list({ q: 'PC-01', page: 1, pageSize: 10 }) as {
      items: { roomId: number; tagIds: number[] }[];
    };
    expect(b.s.rooms.get(d.items[0]!.roomId).name).toBe('Lab 01');
    expect(b.s.tags.get(d.items[0]!.tagIds[0]!).name).toBe('t-01');
    expect(b.s.schedules.list().find((s) => s.name === 'Manhã 01')!.targetCount).toBe(1);
  });

  it('AC-202-02: applying a batch twice changes nothing; a failure mid-batch applies nothing', () => {
    const a = pc();
    const b = pc();
    inventory(a, '01');
    const { entries } = changesSince(a.db, 0);
    expect(applyRemote(b.db, entries, { now: T0 }).applied).toBe(entries.length);
    const before = JSON.stringify(state(b));
    const log = JSON.stringify(b.db.all('SELECT * FROM change_log ORDER BY seq'));
    const again = applyRemote(b.db, entries, { now: T0 });
    expect(again).toMatchObject({ applied: 0, skipped: entries.length });
    expect(JSON.stringify(state(b))).toBe(before);
    expect(JSON.stringify(b.db.all('SELECT * FROM change_log ORDER BY seq'))).toBe(log);

    const c = pc();
    const broken = entries.map((e) =>
      e.entity === 'schedule' ? { ...e, payload: { ...e.payload, weekdays: 999 } } : e,
    );
    expect(() => applyRemote(c.db, broken, { now: T0 })).toThrow(); // CHECK constraint
    expect(c.db.all('SELECT * FROM rooms')).toEqual([]);
    expect(c.db.all('SELECT * FROM change_log')).toEqual([]);
  });

  it('AC-202-05: a delete travels as a tombstone and is never resurrected by an older version', () => {
    const a = pc();
    const b = pc();
    const x = inventory(a, '01');
    sync(a, b);
    const old = changesSince(a.db, 0).entries;
    a.s.devices.delete(x.dev, ACTOR);
    a.s.rooms.delete(x.room, true, ACTOR);
    sync(a, b);
    expect(b.db.all('SELECT * FROM devices')).toEqual([]);
    expect(b.db.all('SELECT * FROM rooms')).toEqual([]);
    applyRemote(b.db, old, { now: T0 }); // a stale copy arriving through a third PC
    expect(b.db.all('SELECT * FROM devices')).toEqual([]);
    expect(state(a)).toEqual(state(b));
  });

  it('AC-202-06: machine settings never apply; shared settings do', () => {
    const a = pc();
    const b = pc();
    a.s.settings.update({ 'wake.repeat': 5, 'wake.interfaces': ['10.0.0.9'] }, null);
    const entries = changesSince(a.db, 0).entries;
    expect(entries.map((e) => e.entityId)).toEqual(['wake.repeat']); // never logged on A either
    // Even a forged entry for a machine key is ignored.
    applyRemote(
      b.db,
      [
        ...entries,
        {
          ...entries[0]!,
          entityId: 'wake.interfaces',
          payload: { value: ['1.2.3.4'], updatedBy: null },
        },
      ],
      { now: T0 },
    );
    b.s.settings.reload();
    expect(b.s.settings.get('wake.repeat')).toBe(5);
    expect(b.s.settings.get('wake.interfaces')).toEqual([]);
  });

  it('pause and schedule runs travel; a run keeps its identity and executor', () => {
    const a = pc();
    const b = pc();
    const x = inventory(a, '01');
    a.s.scheduler.pause({ reason: 'recesso' }, ACTOR);
    sync(a, b);
    expect(b.s.scheduler.pauseState()).toMatchObject({ reason: 'recesso' });
    a.s.scheduler.resume(ACTOR);
    a.db.run(
      "INSERT INTO schedule_runs (schedule_id, planned_at, claimed_at, status, claimed_by_instance) VALUES (?, 1, 1, 'executado', 'pc-a')",
      [x.sched],
    );
    const runId = a.db.get<{ id: number }>('SELECT id FROM schedule_runs')!.id;
    changeLog(a.db).touch('schedule_run', runId); // as the scheduler repository logs it
    sync(a, b);
    expect(b.s.scheduler.pauseState()).toBeNull();
    expect(b.db.get('SELECT status, claimed_by_instance AS by FROM schedule_runs')).toEqual({
      status: 'executado',
      by: 'pc-a',
    });
    expect(b.db.get<{ uuid: string }>('SELECT uuid FROM schedule_runs')!.uuid).toBe(
      a.db.get<{ uuid: string }>('SELECT uuid FROM schedule_runs')!.uuid,
    );
  });
});

describe('conflicts (FR-203, ADR-040)', () => {
  it('AC-203-01: concurrent renames converge on the higher version and the loser is listed', () => {
    const a = pc();
    const b = pc();
    const x = inventory(a, '01');
    sync(a, b);
    const roomOnB = b.s.rooms.list()[0]!.id;
    a.s.rooms.update(x.room, { name: 'Lab Azul' }, ACTOR);
    b.s.rooms.update(roomOnB, { name: 'Lab Verde' }, ACTOR);
    b.s.rooms.update(roomOnB, { name: 'Lab Verde 2' }, ACTOR); // B wrote more: higher Lamport rev
    const r1 = pull(b, a);
    const r2 = pull(a, b);
    sync(a, b);
    expect(a.s.rooms.get(x.room).name).toBe('Lab Verde 2');
    expect(b.s.rooms.get(roomOnB).name).toBe('Lab Verde 2');
    const conflicts = [...r1.conflicts, ...r2.conflicts].filter((c) => c.kind === 'concurrent');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(JSON.stringify(conflicts)).toContain('Lab Azul');
  });

  it('AC-203-02: the same MAC registered on both PCs ends as one machine on both', () => {
    const a = pc();
    const b = pc();
    a.s.devices.create({ name: 'Recepção', mac: '00:BB:00:00:00:01' }, ACTOR);
    b.s.devices.create({ name: 'PC da recepção', mac: '00:BB:00:00:00:01' }, ACTOR);
    const r = pull(b, a);
    sync(a, b);
    expect(a.db.all('SELECT mac FROM devices')).toEqual([{ mac: '00:BB:00:00:00:01' }]);
    expect(state(a)).toEqual(state(b));
    expect([...r.conflicts].map((c) => c.kind)).toContain('duplicate_mac');
  });

  it('AC-203-03: two rooms named "Lab 1" end as "Lab 1" and "Lab 1 (2)", the same way round', () => {
    const a = pc();
    const b = pc();
    a.s.rooms.create({ name: 'Lab 1', code: 'LAB1' }, ACTOR);
    b.s.rooms.create({ name: 'Lab 1', code: 'LAB1' }, ACTOR);
    sync(a, b);
    const names = (p: Pc) =>
      p.db.all<{ uuid: string; name: string; code: string }>(
        'SELECT uuid, name, code FROM rooms ORDER BY uuid',
      );
    expect(names(a)).toEqual(names(b));
    expect(names(a).map((r) => r.name)).toEqual(['Lab 1', 'Lab 1 (2)']);
    expect(names(a).map((r) => r.code)).toEqual(['LAB1', 'LAB1-2']);
    expect(state(a)).toEqual(state(b));
  });

  it('two users "admin" keep both accounts: the larger UUID becomes "admin-2"', () => {
    const a = pc();
    const b = pc();
    a.db.run(
      "INSERT INTO users (username, password_hash, role, created_at, password_changed_at) VALUES ('admin', 'h1', 'admin', 0, 0)",
    );
    b.db.run(
      "INSERT INTO users (username, password_hash, role, created_at, password_changed_at) VALUES ('admin', 'h2', 'admin', 0, 0)",
    );
    for (const p of [a, b]) p.db.transaction(() => require_touch(p));
    sync(a, b);
    expect(a.db.all('SELECT username FROM users ORDER BY username')).toEqual([
      { username: 'admin' },
      { username: 'admin-2' },
    ]);
    expect(state(a)).toEqual(state(b));
  });

  it('an exception for a schedule deleted here is dropped everywhere', () => {
    const a = pc();
    const b = pc();
    const x = inventory(a, '01');
    sync(a, b);
    const schedOnB = b.s.schedules.list()[0]!.id;
    a.s.schedules.createException(
      {
        scheduleId: x.sched,
        startDate: '2026-12-24',
        endDate: '2026-12-31',
        description: 'Recesso',
      },
      ACTOR,
    );
    b.s.schedules.delete(schedOnB, ACTOR);
    sync(a, b);
    expect(a.db.all('SELECT * FROM schedules')).toEqual([]);
    expect(a.db.all('SELECT * FROM schedule_exceptions')).toEqual([]);
    expect(state(a)).toEqual(state(b));
  });
});

describe('joining a team (D7-01)', () => {
  it('replaces the joiner’s replicated data with the team state in one go, keeping local data', () => {
    const team = pc();
    const joiner = pc();
    inventory(team, '01');
    inventory(joiner, '99');
    joiner.db.run(
      "INSERT INTO machine_settings (key, value, updated_at) VALUES ('wake.interfaces', '[\"10.9.9.9\"]', 0)",
    );
    replaceWithTeamState(joiner.db, changesSince(team.db, 0).entries, T0);
    expect(joiner.s.rooms.list().map((r) => r.name)).toEqual(['Lab 01']);
    expect(state(joiner)).toEqual(state(team));
    expect(joiner.db.get('SELECT value FROM machine_settings')).toEqual({ value: '["10.9.9.9"]' });
  });
});

function require_touch(p: Pc) {
  // Raw-SQL users above: log them like the repository would.
  for (const r of p.db.all<{ id: number }>('SELECT id FROM users'))
    changeLog(p.db).touch('user', r.id);
}
