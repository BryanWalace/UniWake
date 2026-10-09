/**
 * The local change log (ADR-031 §4–§6): one row per replicated entity holding its latest full
 * snapshot, or a tombstone. Repositories call `touch` after a write and `tombstone` before a delete,
 * inside the write's transaction; `verifyChangeLog` proves no write path skipped it.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../connection';
import {
  BASELINE_ORDER,
  type EntityName,
  PAUSE_ID,
  pauseSnapshot,
  type RowEntity,
  rowSnapshot,
  ROW_ENTITIES,
  settingSnapshot,
  TABLE,
  TOUCH_SETS_UPDATED_AT,
} from './entities';
import { ensureInstance, nextRev } from './instance';
import { scheduleRunUuid } from './uuid';

const TARGET_TABLE: Record<string, string> = { room: 'rooms', tag: 'tags', device: 'devices' };

export class ChangeLog {
  constructor(
    private readonly db: Db,
    private now: () => number = Date.now,
  ) {}

  setClock(now: () => number): void {
    this.now = now;
  }

  instanceId(): string {
    return ensureInstance(this.db, this.now()).instanceId;
  }

  /** The row's global identity, assigned on first use (F6-02). */
  uuidOf(entity: RowEntity, id: number): string | null {
    const table = TABLE[entity];
    const row = this.db.get<{ uuid: string | null }>(`SELECT uuid FROM ${table} WHERE id = ?`, [
      id,
    ]);
    if (!row) return null;
    if (row.uuid !== null) return row.uuid;
    const uuid = entity === 'schedule_run' ? this.runUuid(id) : randomUUID();
    this.db.run(`UPDATE ${table} SET uuid = ? WHERE id = ?`, [uuid, id]);
    return uuid;
  }

  private runUuid(runId: number): string {
    const r = this.db.get<{ schedule_id: number; planned_at: number }>(
      'SELECT schedule_id, planned_at FROM schedule_runs WHERE id = ?',
      [runId],
    )!;
    return scheduleRunUuid(this.uuidOf('schedule', r.schedule_id)!, r.planned_at);
  }

  /** Records the current state of a replicated row (call after every write to it). */
  touch(entity: RowEntity, id: number): void {
    this.db.transaction(() => {
      const uuid = this.uuidOf(entity, id);
      if (uuid === null) return;
      if (entity === 'schedule') this.fillTargetUuids(id);
      const instance = this.instanceId();
      const rev = nextRev(this.db);
      const at = this.now();
      const setUpdatedAt = TOUCH_SETS_UPDATED_AT.has(entity) ? ', updated_at = ?' : '';
      this.db.run(
        `UPDATE ${TABLE[entity]} SET rev = ?, updated_by_instance = ?${setUpdatedAt} WHERE id = ?`,
        setUpdatedAt ? [rev, instance, at, id] : [rev, instance, id],
      );
      this.write(entity, uuid, 'upsert', rev, instance, at, rowSnapshot(this.db, entity, id)!);
    });
  }

  touchAll(entity: RowEntity, ids: readonly number[]): void {
    if (ids.length === 0) return;
    this.db.transaction(() => {
      for (const id of ids) this.touch(entity, id);
    });
  }

  /** Records the current value of a shared setting. */
  touchSetting(key: string): void {
    this.db.transaction(() => {
      const snap = settingSnapshot(this.db, key);
      if (!snap) return;
      const instance = this.instanceId();
      const rev = nextRev(this.db);
      this.db.run('UPDATE settings SET rev = ?, updated_by_instance = ? WHERE key = ?', [
        rev,
        instance,
        key,
      ]);
      this.write('setting', key, 'upsert', rev, instance, this.now(), snap);
    });
  }

  /** Records the scheduler pause (set or cleared). */
  touchPause(): void {
    this.db.transaction(() => {
      const instance = this.instanceId();
      const rev = nextRev(this.db);
      this.write(
        'scheduler_pause',
        PAUSE_ID,
        'upsert',
        rev,
        instance,
        this.now(),
        pauseSnapshot(this.db),
      );
    });
  }

  /** Replaces the entity's log row with a tombstone (call before deleting the row). */
  tombstone(entity: RowEntity, ids: number | readonly number[]): void {
    const list = typeof ids === 'number' ? [ids] : ids;
    if (list.length === 0) return;
    this.db.transaction(() => {
      const instance = this.instanceId();
      for (const id of list) {
        const uuid = this.db.get<{ uuid: string | null }>(
          `SELECT uuid FROM ${TABLE[entity]} WHERE id = ?`,
          [id],
        )?.uuid;
        // A row never logged is unknown to every peer: nothing to delete there.
        if (!uuid) continue;
        this.write(entity, uuid, 'delete', nextRev(this.db), instance, this.now(), null);
      }
    });
  }

  /** Local retention (D6-06): drops log rows of rows pruned here, without tombstones. */
  forget(entity: RowEntity, uuids: readonly string[]): void {
    for (const uuid of uuids) {
      this.db.run('DELETE FROM change_log WHERE entity = ? AND entity_id = ?', [entity, uuid]);
    }
  }

  /** Keeps a schedule's target UUIDs (ADR-031 §8): referenced rows get theirs first. */
  private fillTargetUuids(scheduleId: number): void {
    const rows = this.db.all<{ rowid: number; type: string; ref_id: number }>(
      `SELECT rowid, type, ref_id FROM schedule_targets
       WHERE schedule_id = ? AND ref_id IS NOT NULL AND ref_uuid IS NULL`,
      [scheduleId],
    );
    for (const r of rows) {
      const table = TARGET_TABLE[r.type];
      if (!table) continue;
      const entity = (Object.keys(TABLE) as RowEntity[]).find((e) => TABLE[e] === table)!;
      this.db.run('UPDATE schedule_targets SET ref_uuid = ? WHERE rowid = ?', [
        this.uuidOf(entity, r.ref_id),
        r.rowid,
      ]);
    }
  }

  private write(
    entity: EntityName,
    entityId: string,
    op: 'upsert' | 'delete',
    rev: number,
    instance: string,
    at: number,
    payload: Record<string, unknown> | null,
  ): void {
    this.db.run('DELETE FROM change_log WHERE entity = ? AND entity_id = ?', [entity, entityId]);
    this.db.run(
      `INSERT INTO change_log (entity, entity_id, op, rev, instance_id, at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entity, entityId, op, rev, instance, at, payload === null ? null : JSON.stringify(payload)],
    );
  }
}

const registry = new WeakMap<Db, ChangeLog>();

/** The change log of a connection (one per `Db`, F6-01). */
export function changeLog(db: Db): ChangeLog {
  let log = registry.get(db);
  if (!log) registry.set(db, (log = new ChangeLog(db)));
  return log;
}

/** Uses the hub's clock for log times (composition root and test harnesses). */
export function configureChangeLog(db: Db, now: () => number): ChangeLog {
  const log = changeLog(db);
  log.setClock(now);
  return log;
}

/**
 * Logs every replicated row that has no revision yet (data from before migration 004, or written
 * by a path that does not log, such as the demo seed). Idempotent. Returns how many were logged.
 */
export function baselineChangeLog(db: Db): number {
  const log = changeLog(db);
  let n = 0;
  db.transaction(() => {
    for (const entity of BASELINE_ORDER) {
      const ids = db
        .all<{ id: number }>(`SELECT id FROM ${TABLE[entity]} WHERE rev = 0 ORDER BY id`)
        .map((r) => r.id);
      log.touchAll(entity, ids);
      n += ids.length;
    }
    for (const { key } of db.all<{ key: string }>('SELECT key FROM settings WHERE rev = 0')) {
      log.touchSetting(key);
      n++;
    }
    const pauseLogged = db.get(
      "SELECT 1 FROM change_log WHERE entity = 'scheduler_pause' AND entity_id = ?",
      [PAUSE_ID],
    );
    if (!pauseLogged && pauseSnapshot(db).pause !== null) {
      log.touchPause();
      n++;
    }
  });
  return n;
}

interface LogRow {
  entity: string;
  entity_id: string;
  op: string;
  rev: number;
  payload: string | null;
}

/**
 * ADR-031 §6 / R6-01: every replicated row has a log row with its `rev` and current snapshot; every
 * upsert row has a live row; no tombstone has one. Returns the problems found (empty = consistent).
 */
export function verifyChangeLog(db: Db): string[] {
  const problems: string[] = [];
  const log = new Map<string, LogRow>();
  for (const r of db.all<LogRow>('SELECT entity, entity_id, op, rev, payload FROM change_log')) {
    log.set(`${r.entity}/${r.entity_id}`, r);
  }
  const seen = new Set<string>();
  const check = (key: string, rev: number | null, snapshot: unknown) => {
    seen.add(key);
    const l = log.get(key);
    if (!l) return problems.push(`${key}: not in the change log`);
    if (l.op !== 'upsert') return problems.push(`${key}: live row has a tombstone`);
    if (rev !== null && l.rev !== rev) problems.push(`${key}: rev ${rev} ≠ logged ${l.rev}`);
    if (l.payload !== JSON.stringify(snapshot)) {
      problems.push(
        `${key}: snapshot changed without logging\n  logged ${l.payload}\n  now    ${JSON.stringify(snapshot)}`,
      );
    }
    return 0;
  };
  for (const entity of ROW_ENTITIES) {
    const rows = db.all<{ id: number; uuid: string | null; rev: number; ubi: string | null }>(
      `SELECT id, uuid, rev, updated_by_instance AS ubi FROM ${TABLE[entity]}`,
    );
    for (const r of rows) {
      if (r.uuid === null || r.rev === 0 || r.ubi === null) {
        problems.push(`${entity}#${r.id}: never logged (uuid/rev/updated_by_instance missing)`);
        continue;
      }
      check(`${entity}/${r.uuid}`, r.rev, rowSnapshot(db, entity, r.id));
    }
  }
  for (const r of db.all<{ key: string; rev: number }>('SELECT key, rev FROM settings')) {
    check(`setting/${r.key}`, r.rev, settingSnapshot(db, r.key));
  }
  const pause = pauseSnapshot(db);
  if (pause.pause !== null || log.has(`scheduler_pause/${PAUSE_ID}`)) {
    check(`scheduler_pause/${PAUSE_ID}`, null, pause);
  }
  for (const [key, l] of log) {
    if (l.op === 'upsert' && !seen.has(key)) problems.push(`${key}: logged but the row is gone`);
  }
  return problems;
}
