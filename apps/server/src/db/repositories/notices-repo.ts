import type { DashboardNotice, MorningResult } from '@uniwake/shared';
import type { NoticesRepo } from '../../application/notices/notices-service';
import type { Db } from '../connection';

interface Row {
  id: number;
  type: string;
  created_at: number;
  data: string;
  acknowledged_at: number | null;
}

const toNotice = (r: Row): DashboardNotice => ({
  id: r.id,
  type: r.type,
  createdAt: r.created_at,
  data: JSON.parse(r.data) as Record<string, unknown>,
});

export class SqliteNoticesRepo implements NoticesRepo {
  constructor(private readonly db: Db) {}

  open(limit: number): DashboardNotice[] {
    return this.db
      .all<Row>(
        `SELECT id, type, created_at, data, acknowledged_at FROM notices
         WHERE acknowledged_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?`,
        [limit],
      )
      .map(toNotice);
  }

  get(id: number) {
    const r = this.db.get<Row>(
      'SELECT id, type, created_at, data, acknowledged_at FROM notices WHERE id = ?',
      [id],
    );
    return r ? { ...toNotice(r), acknowledgedAt: r.acknowledged_at } : undefined;
  }

  insert(type: string, data: object, at: number): number {
    return this.db.run('INSERT INTO notices (type, created_at, data) VALUES (?, ?, ?)', [
      type,
      at,
      JSON.stringify(data),
    ]).lastInsertRowid;
  }

  updateData(id: number, data: object): void {
    this.db.run('UPDATE notices SET data = ? WHERE id = ?', [JSON.stringify(data), id]);
  }

  acknowledge(id: number, by: number | null, at: number): boolean {
    return (
      this.db.run(
        'UPDATE notices SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL',
        [at, by, id],
      ).changes === 1
    );
  }

  openMorningResult(day: string): { id: number; data: MorningResult } | undefined {
    const r = this.db.get<{ id: number; data: string }>(
      `SELECT id, data FROM notices WHERE type = 'morning_result' AND acknowledged_at IS NULL
         AND json_extract(data, '$.day') = ? ORDER BY id DESC LIMIT 1`,
      [day],
    );
    return r ? { id: r.id, data: JSON.parse(r.data) as MorningResult } : undefined;
  }
}
