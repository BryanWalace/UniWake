/**
 * v1.4 machine-local state of "Backup e migração" (plan §16.3), in `system_state`: standby after
 * an import, the last import (for "Desfazer") and the last automatic export.
 */
import type { MigrationState } from '@uniwake/shared';
import type { Db } from '../connection';

const KEYS = {
  standby: 'standby',
  lastImport: 'migration.lastImport',
  lastAutoExport: 'export.lastAuto',
} as const;
type Key = keyof typeof KEYS;

export class SqliteMigrationStateRepo {
  constructor(private readonly db: Db) {}

  private read<T>(k: Key): T | null {
    const v = this.db.get<{ value: string }>('SELECT value FROM system_state WHERE key = ?', [
      KEYS[k],
    ])?.value;
    if (v === undefined) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  private write(k: Key, value: unknown): void {
    if (value === null) this.db.run('DELETE FROM system_state WHERE key = ?', [KEYS[k]]);
    else
      this.db.run(
        'INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [KEYS[k], JSON.stringify(value)],
      );
  }

  standby(): MigrationState['standby'] {
    return this.read('standby');
  }
  setStandby(v: MigrationState['standby']): void {
    this.write('standby', v);
  }
  lastImport(): MigrationState['lastImport'] {
    return this.read('lastImport');
  }
  setLastImport(v: MigrationState['lastImport']): void {
    this.write('lastImport', v);
  }
  lastAutoExport(): MigrationState['lastAutoExport'] {
    return this.read('lastAutoExport');
  }
  setLastAutoExport(v: MigrationState['lastAutoExport']): void {
    this.write('lastAutoExport', v);
  }
}
