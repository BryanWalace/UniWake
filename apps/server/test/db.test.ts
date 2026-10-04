import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Db, ForeignKeyError, openMemoryDb, UniqueConstraintError } from '../src/db/connection';
import {
  currentSchemaVersion,
  latestSchemaVersion,
  migrate,
  type Migration,
} from '../src/db/migrate';

const T = 1_760_000_000_000;

function freshDb(): Db {
  const db = openMemoryDb();
  migrate(db, undefined, { now: () => T });
  return db;
}

function insertRoom(db: Db, name: string, code: string): number {
  return db.run(
    'INSERT INTO rooms (name, code, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [name, code, '#2563eb', T, T],
  ).lastInsertRowid;
}

function insertDevice(db: Db, mac: string, roomId: number | null): number {
  return db.run(
    'INSERT INTO devices (name, mac, room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['PC', mac, roomId, T, T],
  ).lastInsertRowid;
}

describe('migrations (constitution §2.3)', () => {
  it('applies the initial schema once and is idempotent', () => {
    const db = openMemoryDb();
    expect(migrate(db, undefined, { now: () => T })).toEqual({ from: 0, to: 1, applied: [1] });
    expect(migrate(db)).toEqual({ from: 1, to: 1, applied: [] });
    expect(currentSchemaVersion(db)).toBe(latestSchemaVersion());
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((r) => r.name);
    for (const t of [
      'rooms',
      'devices',
      'device_state',
      'tags',
      'device_tags',
      'device_events',
      'daily_uptime',
      'schedules',
      'schedule_targets',
      'schedule_exceptions',
      'schedule_runs',
      'wake_jobs',
      'wake_job_devices',
      'packet_log',
      'users',
      'sessions',
      'audit_log',
      'settings',
      'system_state',
      'enrollment_tokens',
      'notices',
      'backups',
      'schema_migrations',
    ]) {
      expect(tables, t).toContain(t);
    }
  });

  it('calls beforeMigrate only for existing databases with pending migrations', () => {
    const extra: Migration[] = [
      { version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' },
      { version: 2, name: 'b', sql: 'CREATE TABLE b (x INTEGER)' },
    ];
    const db = openMemoryDb();
    const calls: [number, number][] = [];
    migrate(db, extra.slice(0, 1), { beforeMigrate: (f, t) => calls.push([f, t]) });
    expect(calls).toEqual([]); // fresh DB: no backup needed
    migrate(db, extra, { beforeMigrate: (f, t) => calls.push([f, t]) });
    expect(calls).toEqual([[1, 2]]);
    migrate(db, extra, { beforeMigrate: (f, t) => calls.push([f, t]) });
    expect(calls).toHaveLength(1);
  });

  it('a failing migration rolls back and is not recorded', () => {
    const db = openMemoryDb();
    const broken: Migration[] = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE ok (x INTEGER)' },
      {
        version: 2,
        name: 'broken',
        sql: 'CREATE TABLE half (x INTEGER); SELECT * FROM missing_table;',
      },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(currentSchemaVersion(db)).toBe(1);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'half'")).toBeUndefined();
  });
});

describe('Db wrapper (ADR-017)', () => {
  it('sets foreign keys, busy timeout and synchronous=FULL', () => {
    const db = freshDb();
    expect(db.pragma('foreign_keys')).toBe(1);
    expect(db.pragma('busy_timeout')).toBe(5000);
    expect(db.pragma('synchronous')).toBe(2);
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('uses WAL for file databases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniwake-db-'));
    dirs.push(dir);
    const db = new Db(join(dir, 'test.db'));
    expect(db.pragma('journal_mode')).toBe('wal');
    db.close();
    db.close(); // idempotent
  });

  it('maps unique violations to UniqueConstraintError with table and columns', () => {
    const db = freshDb();
    insertDevice(db, 'AA:BB:CC:DD:EE:01', null);
    try {
      insertDevice(db, 'AA:BB:CC:DD:EE:01', null);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UniqueConstraintError);
      expect(e).toMatchObject({ table: 'devices', columns: ['mac'] });
    }
    // composite unique key used by claim-then-execute
    const s = db.run(
      "INSERT INTO schedules (name, weekdays, time_local, timezone, created_at, updated_at) VALUES ('s', 31, '06:50', 'America/Sao_Paulo', ?, ?)",
      [T, T],
    ).lastInsertRowid;
    const claim = () =>
      db.run(
        "INSERT INTO schedule_runs (schedule_id, planned_at, claimed_at, status) VALUES (?, ?, ?, 'executado')",
        [s, T, T],
      );
    claim();
    expect(claim).toThrow(UniqueConstraintError);
  });

  it('room names are unique case-insensitively', () => {
    const db = freshDb();
    insertRoom(db, 'Lab 3', 'LAB3');
    expect(() => insertRoom(db, 'lab 3', 'LAB3-2')).toThrow(UniqueConstraintError);
  });

  it('maps foreign key violations and applies cascades / set null', () => {
    const db = freshDb();
    expect(() => insertDevice(db, 'AA:BB:CC:DD:EE:02', 999)).toThrow(ForeignKeyError);
    const room = insertRoom(db, 'Lab 1', 'LAB1');
    const dev = insertDevice(db, 'AA:BB:CC:DD:EE:03', room);
    const tag = db.run(
      "INSERT INTO tags (name, color) VALUES ('professor', '#000000')",
    ).lastInsertRowid;
    db.run('INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)', [dev, tag]);
    db.run('INSERT INTO device_state (device_id) VALUES (?)', [dev]);

    db.run('DELETE FROM rooms WHERE id = ?', [room]);
    expect(
      db.get<{ room_id: number | null }>('SELECT room_id FROM devices WHERE id = ?', [dev])
        ?.room_id,
    ).toBeNull();

    db.run('DELETE FROM devices WHERE id = ?', [dev]);
    expect(db.get('SELECT * FROM device_tags WHERE device_id = ?', [dev])).toBeUndefined();
    expect(db.get('SELECT * FROM device_state WHERE device_id = ?', [dev])).toBeUndefined();
  });

  it('transactions roll back on error; nested failures roll back only the savepoint', () => {
    const db = freshDb();
    expect(() =>
      db.transaction(() => {
        insertRoom(db, 'A', 'AA');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.get('SELECT * FROM rooms')).toBeUndefined();

    db.transaction(() => {
      insertRoom(db, 'B', 'BB');
      expect(() =>
        db.transaction(() => {
          insertRoom(db, 'C', 'CC');
          throw new Error('inner');
        }),
      ).toThrow('inner');
    });
    expect(db.all<{ name: string }>('SELECT name FROM rooms').map((r) => r.name)).toEqual(['B']);
  });

  it('supports named parameters', () => {
    const db = freshDb();
    db.run('INSERT INTO system_state (key, value) VALUES (:k, :v)', { k: 'pause', v: '{}' });
    expect(
      db.get<{ value: string }>('SELECT value FROM system_state WHERE key = :k', { k: 'pause' })
        ?.value,
    ).toBe('{}');
  });
});
