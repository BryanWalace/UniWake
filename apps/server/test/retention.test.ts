import { afterEach, describe, expect, it } from 'vitest';
import {
  RETENTION_CHUNK,
  RetentionService,
} from '../src/application/maintenance/retention-service';
import type { Db } from '../src/db/connection';
import { SqliteRetentionRepo } from '../src/db/repositories/retention-repo';
import { createServices } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { MemoryLogger } from './fakes/system-fakes';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const DAY = 86_400_000;
const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function world(opts: { busy?: () => boolean } = {}) {
  const db = testDb();
  dbs.push(db);
  const clock = new FakeClock(T0);
  const services = createServices(db, clock, fakePorts(clock));
  let yields = 0;
  const logger = new MemoryLogger();
  const retention = new RetentionService({
    repo: new SqliteRetentionRepo(db),
    settings: services.settings,
    clock,
    logger,
    busy: opts.busy ?? (() => false),
    yieldNow: () => {
      yields++;
      return Promise.resolve();
    },
  });
  return { db, clock, services, retention, logger, yields: () => yields };
}

const count = (db: Db, table: string) =>
  db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;

function seed(db: Db) {
  const old = (days: number) => T0 - days * DAY;
  db.run(
    "INSERT INTO rooms (name, code, color, created_at, updated_at) VALUES ('Lab', 'LAB', '#000', 0, 0)",
  );
  db.run(
    "INSERT INTO devices (name, mac, room_id, created_at, updated_at) VALUES ('PC', '00:AA:00:00:00:01', 1, 0, 0)",
  );
  db.run(
    "INSERT INTO users (username, password_hash, role, created_at, password_changed_at) VALUES ('u', 'x', 'operator', 0, 0)",
  );
  db.run(
    "INSERT INTO schedules (name, weekdays, time_local, timezone, created_at, updated_at) VALUES ('S', 31, '06:50', 'America/Sao_Paulo', 0, 0)",
  );
  for (const days of [31, 29]) {
    db.run(
      "INSERT INTO packet_log (job_id, device_id, mac, src_ip, dst_ip, port, repeat, at, outcome) VALUES (1, 1, 'm', 's', 'd', 9, 1, ?, 'sent')",
      [old(days)],
    );
  }
  for (const days of [181, 179]) {
    db.run("INSERT INTO device_events (device_id, at, type) VALUES (1, ?, 'status')", [old(days)]);
    db.run(
      'INSERT INTO schedule_runs (schedule_id, planned_at, claimed_at, status) VALUES (1, ?, ?, ?)',
      [old(days), old(days), 'ok'],
    );
    for (const state of ['concluido', 'verificando']) {
      const job = db.run(
        "INSERT INTO wake_jobs (source, target, state, created_at) VALUES ('manual', '{}', ?, ?)",
        [state, old(days)],
      ).lastInsertRowid;
      db.run(
        "INSERT INTO wake_job_devices (job_id, device_id, mac, result) VALUES (?, 1, 'm', 'acordou')",
        [job],
      );
    }
  }
  db.run(
    "INSERT INTO daily_uptime (device_id, day, online_ms) VALUES (1, '2026-04-01', 1), (1, '2026-09-01', 1)",
  );
  for (const days of [366, 364]) {
    db.run("INSERT INTO audit_log (at, actor_label, action, result) VALUES (?, 'x', 'a', 'ok')", [
      old(days),
    ]);
  }
  // sessions: absolutely expired, idle for 13 h, fresh
  const session = (id: string, lastSeen: number, expires: number) =>
    db.run(
      'INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, 1, 0, ?, ?)',
      [id, lastSeen, expires],
    );
  session('expired', T0, T0 - 1);
  session('idle', T0 - 13 * 3_600_000, T0 + DAY);
  session('fresh', T0 - 60_000, T0 + DAY);
  // tokens: expired 31 d ago, revoked 31 d ago, valid
  const token = (h: string, expires: number, revoked: number | null) =>
    db.run(
      'INSERT INTO enrollment_tokens (token_hash, room_id, created_at, expires_at, max_uses, revoked_at) VALUES (?, 1, 0, ?, 100, ?)',
      [h, expires, revoked],
    );
  token('a', old(31), null);
  token('b', T0 + DAY, old(31));
  token('c', T0 + DAY, null);
  // notices: acknowledged 31 d ago, acknowledged yesterday, open and recent, open but 181 d old
  const notice = (created: number, ack: number | null) =>
    db.run("INSERT INTO notices (type, created_at, acknowledged_at) VALUES ('t', ?, ?)", [
      created,
      ack,
    ]);
  notice(old(40), old(31));
  notice(old(2), old(1));
  notice(old(1), null);
  notice(old(181), null);
}

describe('retention cleanup (spec §9)', () => {
  it('purges by the configured windows and keeps everything newer or still in use', async () => {
    const w = world();
    seed(w.db);
    const report = await w.retention.run();
    expect(report).toEqual({
      packet_log: 1,
      device_events: 1,
      daily_uptime: 1,
      schedule_runs: 1,
      wake_jobs: 1,
      audit_log: 1,
      sessions: 2,
      enrollment_tokens: 2,
      notices: 2,
    });
    expect(count(w.db, 'packet_log')).toBe(1);
    // the old *running* job stays, with its device rows; the old finished one went with its rows
    expect(
      w.db.all<{ state: string }>('SELECT state FROM wake_jobs ORDER BY id').map((r) => r.state),
    ).toEqual(['verificando', 'concluido', 'verificando']);
    expect(count(w.db, 'wake_job_devices')).toBe(3);
    expect(
      w.db.all<{ id_hash: string }>('SELECT id_hash FROM sessions').map((r) => r.id_hash),
    ).toEqual(['fresh']);
    expect(
      w.db
        .all<{ token_hash: string }>('SELECT token_hash FROM enrollment_tokens')
        .map((r) => r.token_hash),
    ).toEqual(['c']);
    expect(count(w.db, 'notices')).toBe(2);
    expect(await w.retention.run()).toEqual({}); // idempotent
  });

  it('follows the retention settings', async () => {
    const w = world();
    seed(w.db);
    w.services.settings.update({ 'retention.packetLogDays': 60, 'retention.auditDays': 730 }, null);
    const report = await w.retention.run();
    expect(report?.packet_log).toBeUndefined();
    expect(report?.audit_log).toBeUndefined();
  });

  it(`deletes in chunks of ${RETENTION_CHUNK} rows and yields between them`, async () => {
    const w = world();
    w.db.transaction(() => {
      for (let i = 0; i < 2 * RETENTION_CHUNK + 10; i++) {
        w.db.run(
          "INSERT INTO packet_log (job_id, device_id, mac, src_ip, dst_ip, port, repeat, at, outcome) VALUES (1, 1, 'm', 's', 'd', 9, 1, 0, 'sent')",
        );
      }
    });
    const report = await w.retention.run();
    expect(report?.packet_log).toBe(2 * RETENTION_CHUNK + 10);
    expect(w.yields()).toBe(2);
    expect(count(w.db, 'packet_log')).toBe(0);
  });

  it('never runs during a wake job: postpones and retries in 10 minutes', async () => {
    let busy = true;
    const w = world({ busy: () => busy });
    seed(w.db);
    expect(await w.retention.run()).toBeNull();
    expect(count(w.db, 'packet_log')).toBe(2);
    expect(
      w.logger.entries.some((e) => e.msg === 'retention postponed: a wake job is running'),
    ).toBe(true);

    // via the scheduler: first run 10 min after start (never ran before), busy → retry 10 min later
    w.retention.start();
    await w.clock.advanceAsync(10 * 60_000);
    expect(count(w.db, 'packet_log')).toBe(2);
    busy = false;
    await w.clock.advanceAsync(10 * 60_000);
    expect(count(w.db, 'packet_log')).toBe(1);
    await w.retention.stop();
  });

  it('runs nightly at 01:30 local; after a recent run it waits for the night', async () => {
    const w = world();
    seed(w.db);
    new SqliteRetentionRepo(w.db).setLastRun(T0 - 3_600_000);
    w.retention.start(); // T0 = 06:00 local, ran an hour ago
    await w.clock.advanceAsync(18 * 3_600_000);
    expect(count(w.db, 'packet_log')).toBe(2); // 00:00 local: not yet
    await w.clock.advanceAsync(Date.UTC(2026, 9, 6, 4, 30) - w.clock.now()); // 01:30 local
    expect(count(w.db, 'packet_log')).toBe(1);
    expect(new SqliteRetentionRepo(w.db).lastRun()).toBe(Date.UTC(2026, 9, 6, 4, 30));
    await w.retention.stop();
    expect(w.clock.pendingTimers).toBe(0);
  });
});
