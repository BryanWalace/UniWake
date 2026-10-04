import { type Db, openMemoryDb } from '../../src/db/connection';
import { migrate } from '../../src/db/migrate';

export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0); // 2026-10-05 06:00 America/Sao_Paulo

/** Fresh in-memory database with all migrations applied (ADR-003). */
export function testDb(): Db {
  const db = openMemoryDb();
  migrate(db, undefined, { now: () => T0 });
  return db;
}
