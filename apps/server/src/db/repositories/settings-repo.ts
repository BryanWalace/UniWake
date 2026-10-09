import { isSettingKey, SETTING_DEFS } from '@uniwake/shared';
import type { SettingsRepo } from '../../application/settings/settings-service';
import type { Db } from '../connection';
import { changeLog } from '../sync/change-log';

/** ADR-032: machine-scope keys live in `machine_settings` (never logged); unknown keys stay shared. */
const isMachine = (key: string) => isSettingKey(key) && SETTING_DEFS[key].meta.scope === 'machine';

export class SqliteSettingsRepo implements SettingsRepo {
  constructor(private readonly db: Db) {}

  getAll(): { key: string; value: string }[] {
    return this.db.all<{ key: string; value: string }>(
      'SELECT key, value FROM settings UNION ALL SELECT key, value FROM machine_settings',
    );
  }

  upsert(key: string, valueJson: string, at: number, by: number | null): void {
    const table = isMachine(key) ? 'machine_settings' : 'settings';
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO ${table} (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
        [key, valueJson, at, by],
      );
      if (table === 'settings') changeLog(this.db).touchSetting(key);
    });
  }
}
