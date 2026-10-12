/**
 * Importing a `.uniwake` file into this database (ADR-051): merge = the team-sync applier; replace
 * = wipe the replaced sections (and their change-log rows) first, then apply. Always one
 * transaction; a dry run (preview) rolls back after counting.
 */
import type { ApplyResult, ChangeEntry } from '../../application/team/replica';
import type { Db } from '../connection';
import { applyRemote } from './apply';
import { PAUSE_KEY, type RowEntity, TABLE } from './entities';

export type ImportCategory = 'created' | 'updated' | 'unchanged' | 'ignored';

export interface ImportRun {
  result: ApplyResult;
  /** Per entry key `entity:id`, what happened to it. */
  outcome: Map<string, ImportCategory>;
  /** Replace: rows of this PC that disappear, per entity. */
  removed: Record<string, number>;
}

class Rollback extends Error {
  constructor(readonly run: ImportRun) {
    super('import preview rollback');
  }
}

const isRow = (e: string): e is RowEntity => e in TABLE;
const key = (entity: string, id: string) => `${entity}:${id}`;

/**
 * Entities each replaced section covers, dependents first. Replace keeps the rows the file also
 * has (same UUID: updated in place, so their local ids and machine-local history survive) and
 * deletes the others.
 */
const REPLACE_ENTITIES: Record<string, readonly string[]> = {
  history: ['power_report', 'power_order', 'power_job', 'schedule_run'],
  agents: ['device_agent'],
  schedules: ['schedule_exception', 'schedule', 'scheduler_pause'],
  inventory: ['device', 'tag', 'room'],
  users: ['user'],
  settings: ['setting'],
};
const REPLACE_ORDER = ['history', 'agents', 'schedules', 'inventory', 'users', 'settings'];

/** Replace always covers these together (they reference each other); users/settings only if sent. */
export const REPLACE_ALWAYS = ['history', 'agents', 'schedules', 'inventory'] as const;

/** Deletes this PC's items of an entity that the file does not have; returns how many. */
function removeMissing(db: Db, entity: string, keep: Set<string>): number {
  if (entity === 'setting') {
    const gone = db
      .all<{ key: string }>('SELECT key FROM settings')
      .filter((r) => !keep.has(r.key));
    for (const r of gone) db.run('DELETE FROM settings WHERE key = ?', [r.key]);
    return gone.length;
  }
  if (entity === 'scheduler_pause') {
    if (keep.size > 0) return 0;
    return Number(db.run('DELETE FROM system_state WHERE key = ?', [PAUSE_KEY]).changes);
  }
  if (!isRow(entity)) return 0;
  const gone = db
    .all<{ id: number; uuid: string | null }>(`SELECT id, uuid FROM ${TABLE[entity]}`)
    .filter((r) => r.uuid === null || !keep.has(r.uuid));
  for (const r of gone) db.run(`DELETE FROM ${TABLE[entity]} WHERE id = ?`, [r.id]);
  return gone.length;
}

function exists(db: Db, entity: string, id: string): boolean {
  if (!isRow(entity)) return true; // settings and pause have no row identity to lose
  return db.get(`SELECT 1 FROM ${TABLE[entity]} WHERE uuid = ?`, [id]) !== undefined;
}

function run(
  db: Db,
  entries: readonly ChangeEntry[],
  opts: { replace: readonly string[]; now: number },
): ImportRun {
  const removed: Record<string, number> = {};
  const outcome = new Map<string, ImportCategory>();
  const replaced = REPLACE_ORDER.filter((x) => opts.replace.includes(x)).flatMap(
    (x) => REPLACE_ENTITIES[x]!,
  );
  // First, against our log as it is: created, updated or unchanged (replace: the file always wins).
  for (const e of entries) {
    const local = db.get<{ rev: number; instance_id: string; op: string }>(
      'SELECT rev, instance_id, op FROM change_log WHERE entity = ? AND entity_id = ?',
      [e.entity, e.entityId],
    );
    const k = key(e.entity, e.entityId);
    const newer =
      local !== undefined &&
      (local.rev < e.rev || (local.rev === e.rev && local.instance_id < e.instance));
    if (!local || local.op === 'delete' || !exists(db, e.entity, e.entityId))
      outcome.set(k, 'created');
    else if (local.rev === e.rev && local.instance_id === e.instance) outcome.set(k, 'unchanged');
    else if (newer || replaced.includes(e.entity)) outcome.set(k, 'updated');
    else outcome.set(k, 'unchanged'); // merge and ours is newer: kept
  }
  for (const entity of replaced) {
    const keep = new Set(entries.filter((e) => e.entity === entity).map((e) => e.entityId));
    const n = removeMissing(db, entity, keep);
    if (n > 0) removed[entity] = n;
  }
  if (replaced.length > 0) {
    // Without our versions in the log, every item of the file wins (replace, not merge).
    db.run(
      `DELETE FROM change_log WHERE entity IN (${replaced.map(() => '?').join(',')})`,
      replaced,
    );
  }
  const result = applyRemote(db, entries, { now: opts.now });
  // Items the applier dropped (orphans, e.g. a schedule run without its schedule) are "ignored".
  for (const e of entries) {
    const k = key(e.entity, e.entityId);
    if (outcome.get(k) !== 'unchanged' && !exists(db, e.entity, e.entityId))
      outcome.set(k, 'ignored');
  }
  return { result, outcome, removed };
}

/** Counts what an import would do and leaves the database untouched (FR-403.2). */
export function previewImport(
  db: Db,
  entries: readonly ChangeEntry[],
  opts: { replace: readonly string[]; now: number },
): ImportRun {
  try {
    db.transaction(() => {
      throw new Rollback(run(db, entries, opts));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.run;
    throw e;
  }
  throw new Error('unreachable');
}

/** Applies an import in one transaction (NFR-402); `after` runs inside it (key, standby). */
export function applyImport(
  db: Db,
  entries: readonly ChangeEntry[],
  opts: { replace: readonly string[]; now: number },
  after: () => void = () => undefined,
): ImportRun {
  return db.transaction(() => {
    const r = run(db, entries, opts);
    after();
    return r;
  });
}

/** Whether this PC has lab machines prepared against its own key (ADR-051 key rule). */
export function hasPreparedMachines(db: Db): boolean {
  return (
    db.get(
      'SELECT 1 FROM device_agents WHERE token_hash IS NOT NULL AND revoked_at IS NULL LIMIT 1',
    ) !== undefined
  );
}
