import type { PurgeRule, RetentionRepo } from '../../application/maintenance/retention-service';
import type { Db } from '../connection';

const LAST_RUN_KEY = 'retention.lastRun';
const FINAL_JOB_STATES = "('concluido', 'interrompido', 'falhou')";

/**
 * Deletes up to `limit` rows matching `where`, batched by key so each statement stays short.
 * `key` is the primary key (WITHOUT ROWID tables have no rowid).
 */
function chunk(
  db: Db,
  table: string,
  where: string,
  params: (string | number)[],
  limit: number,
  key = 'rowid',
) {
  return db.run(
    `DELETE FROM ${table} WHERE (${key}) IN (SELECT ${key} FROM ${table} WHERE ${where} LIMIT ?)`,
    [...params, limit],
  ).changes;
}

export class SqliteRetentionRepo implements RetentionRepo {
  constructor(private readonly db: Db) {}

  purge(rule: PurgeRule, limit: number): number {
    const db = this.db;
    switch (rule.table) {
      case 'packet_log':
      case 'device_events':
      case 'audit_log':
        return chunk(db, rule.table, 'at < ?', [rule.before], limit);
      case 'daily_uptime':
        return chunk(db, 'daily_uptime', 'day < ?', [rule.beforeDay], limit, 'device_id, day');
      case 'schedule_runs':
        return chunk(db, 'schedule_runs', 'planned_at < ?', [rule.before], limit);
      case 'wake_jobs':
        // Only finished jobs; their per-device rows go with them (ON DELETE CASCADE).
        return db.transaction(() =>
          chunk(
            db,
            'wake_jobs',
            `created_at < ? AND state IN ${FINAL_JOB_STATES}`,
            [rule.before],
            limit,
          ),
        );
      case 'sessions':
        return chunk(
          db,
          'sessions',
          'expires_at <= ? OR last_seen_at < ?',
          [rule.now, rule.idleBefore],
          limit,
          'id_hash',
        );
      case 'enrollment_tokens':
        return chunk(
          db,
          'enrollment_tokens',
          'expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)',
          [rule.before, rule.before],
          limit,
        );
      case 'notices':
        return chunk(
          db,
          'notices',
          '(acknowledged_at IS NOT NULL AND acknowledged_at < ?) OR created_at < ?',
          [rule.ackBefore, rule.before],
          limit,
        );
    }
  }

  lastRun(): number | null {
    const r = this.db.get<{ value: string }>('SELECT value FROM system_state WHERE key = ?', [
      LAST_RUN_KEY,
    ]);
    return r ? Number(r.value) : null;
  }

  setLastRun(at: number): void {
    this.db.run(
      `INSERT INTO system_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [LAST_RUN_KEY, String(at)],
    );
  }
}
