import type { UpdateState, UpdateStateStore } from '../../application/update/update-service';
import type { Db } from '../connection';

const KEY = 'update.state';

/** Last update check, kept in system_state so it survives restarts (AC-001-06). */
export class SqliteUpdateStateStore implements UpdateStateStore {
  constructor(private readonly db: Db) {}

  load(): UpdateState | null {
    const r = this.db.get<{ value: string }>('SELECT value FROM system_state WHERE key = ?', [KEY]);
    return r ? (JSON.parse(r.value) as UpdateState) : null;
  }

  save(s: UpdateState): void {
    this.db.run(
      'INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [KEY, JSON.stringify(s)],
    );
  }
}
