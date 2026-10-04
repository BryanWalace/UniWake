import type { DemoRepo } from '../../application/demo/demo-seed';
import type { Db } from '../connection';

export class SqliteDemoRepo implements DemoRepo {
  constructor(private readonly db: Db) {}

  isEmpty(): boolean {
    const r = this.db.get<{ n: number }>(
      'SELECT (SELECT COUNT(*) FROM rooms) + (SELECT COUNT(*) FROM devices) AS n',
    );
    return (r?.n ?? 0) === 0;
  }

  backdateInventory(at: number): void {
    this.db.run('UPDATE devices SET created_at = ?, updated_at = ?', [at, at]);
    this.db.run('UPDATE rooms SET created_at = ?, updated_at = ?', [at, at]);
  }
}
