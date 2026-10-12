import { type Db, openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';
import { changeLog } from '../../src/db/sync/change-log';

export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0); // 2026-10-05 06:00 America/Sao_Paulo

/** Fresh in-memory database with all migrations applied (ADR-003). */
export function testDb(): Db {
  const db = openMemoryDb();
  migrate(db, undefined, { now: () => T0 });
  return db;
}

/**
 * Logs the current state of every v1.3 power row (ADR-048). For tests that set up agents, orders
 * or reports with raw SQL, as the repositories would through the change log.
 */
export function relogPower(db: Db): void {
  const log = changeLog(db);
  for (const [entity, table] of [
    ['device_agent', 'device_agents'],
    ['power_job', 'power_jobs'],
    ['power_order', 'power_orders'],
    ['power_report', 'power_reports'],
  ] as const) {
    log.touchAll(
      entity,
      db.all<{ id: number }>(`SELECT id FROM ${table}`).map((r) => r.id),
    );
  }
}
