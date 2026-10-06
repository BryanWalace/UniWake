import type { Db } from '../connection';

const KEY = 'update.autoSkip';

/** The version automatic updates must not retry (M8-F4), kept in system_state. */
export class SqliteUpdateAutoSkip {
  constructor(private readonly db: Db) {}

  get(): string | null {
    return (
      this.db.get<{ value: string }>('SELECT value FROM system_state WHERE key = ?', [KEY])
        ?.value ?? null
    );
  }

  set(version: string | null): void {
    if (version === null) this.db.run('DELETE FROM system_state WHERE key = ?', [KEY]);
    else
      this.db.run(
        'INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [KEY, version],
      );
  }
}
