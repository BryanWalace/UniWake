import type { Tag } from '@uniwake/shared';
import type { TagsRepo } from '../../application/tags/tags-service';
import type { Db } from '../connection';

interface Row {
  id: number;
  name: string;
  color: string;
  device_count: number;
}

const toTag = (r: Row): Required<Tag> => ({
  id: r.id,
  name: r.name,
  color: r.color,
  deviceCount: r.device_count,
});

const SELECT = `SELECT t.id, t.name, t.color,
  (SELECT COUNT(*) FROM device_tags dt WHERE dt.tag_id = t.id) AS device_count FROM tags t`;

export class SqliteTagsRepo implements TagsRepo {
  constructor(private readonly db: Db) {}

  list(): Required<Tag>[] {
    return this.db.all<Row>(`${SELECT} ORDER BY t.name COLLATE NOCASE`).map(toTag);
  }

  get(id: number): Required<Tag> | undefined {
    const r = this.db.get<Row>(`${SELECT} WHERE t.id = ?`, [id]);
    return r ? toTag(r) : undefined;
  }

  nameTaken(name: string, exceptId = 0): boolean {
    return (
      this.db.get('SELECT 1 FROM tags WHERE name = ? COLLATE NOCASE AND id != ?', [
        name,
        exceptId,
      ]) !== undefined
    );
  }

  insert(name: string, color: string): number {
    return this.db.run('INSERT INTO tags (name, color) VALUES (?, ?)', [name, color])
      .lastInsertRowid;
  }

  update(id: number, name: string, color: string): void {
    this.db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', [name, color, id]);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM tags WHERE id = ?', [id]);
  }

  schedulesReferencing(id: number): { id: number; name: string }[] {
    return this.db.all<{ id: number; name: string }>(
      `SELECT DISTINCT s.id, s.name FROM schedules s JOIN schedule_targets t ON t.schedule_id = s.id
       WHERE t.type = 'tag' AND t.ref_id = ? ORDER BY s.name`,
      [id],
    );
  }
}
