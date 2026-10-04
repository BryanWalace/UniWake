/**
 * Forward-only migrations (constitution §2.3). Each migration runs in its own transaction and is
 * recorded in `schema_migrations`. Before the first pending migration on a non-empty database,
 * `beforeMigrate` runs (the backup service uses it for the pre-migration backup).
 */
import type { Db } from './connection';
import { sql as initial } from './migrations/001_initial';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'initial', sql: initial }];

export interface MigrateOptions {
  now?: () => number;
  /** Called once, before applying pending migrations to a database that already has a schema. */
  beforeMigrate?: (fromVersion: number, toVersion: number) => void;
}

export function currentSchemaVersion(db: Db): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  return db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0;
}

export function latestSchemaVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0);
}

export function migrate(
  db: Db,
  migrations: readonly Migration[] = MIGRATIONS,
  opts: MigrateOptions = {},
): { from: number; to: number; applied: number[] } {
  const now = opts.now ?? Date.now;
  const from = currentSchemaVersion(db);
  const pending = [...migrations]
    .filter((m) => m.version > from)
    .sort((a, b) => a.version - b.version);
  if (pending.length === 0) return { from, to: from, applied: [] };

  const to = pending[pending.length - 1]!.version;
  if (from > 0) opts.beforeMigrate?.(from, to);

  const applied: number[] = [];
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        m.version,
        m.name,
        now(),
      ]);
    });
    applied.push(m.version);
  }
  return { from, to, applied };
}
