import type { SettingsRepo } from '../../application/settings/settings-service';
import type { Db } from '../connection';

export class SqliteSettingsRepo implements SettingsRepo {
  constructor(private readonly db: Db) {}

  getAll(): { key: string; value: string }[] {
    return this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  }

  upsert(key: string, valueJson: string, at: number, by: number | null): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
      [key, valueJson, at, by],
    );
  }
}
