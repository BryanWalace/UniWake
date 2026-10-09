import type { DemoRepo } from '../../application/demo/demo-seed';
import type { Db } from '../connection';
import { changeLog } from '../sync/change-log';

export class SqliteDemoRepo implements DemoRepo {
  constructor(private readonly db: Db) {}

  isEmpty(): boolean {
    const r = this.db.get<{ n: number }>(
      'SELECT (SELECT COUNT(*) FROM rooms) + (SELECT COUNT(*) FROM devices) + (SELECT COUNT(*) FROM tags) AS n',
    );
    return (r?.n ?? 0) === 0;
  }

  seededAt(): number | null {
    const r = this.db.get<{ value: string }>(
      "SELECT value FROM system_state WHERE key = 'demo.seededAt'",
    );
    return r ? Number(r.value) : null;
  }

  markSeeded(at: number): void {
    this.db.run(
      `INSERT INTO system_state (key, value) VALUES ('demo.seededAt', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(at)],
    );
  }

  backdateInventory(at: number): void {
    this.db.run('UPDATE devices SET created_at = ?, updated_at = ?', [at, at]);
    this.db.run('UPDATE rooms SET created_at = ?, updated_at = ?', [at, at]);
    const ids = (t: string) => this.db.all<{ id: number }>(`SELECT id FROM ${t}`).map((r) => r.id);
    changeLog(this.db).touchAll('room', ids('rooms'));
    changeLog(this.db).touchAll('device', ids('devices'));
  }
}
