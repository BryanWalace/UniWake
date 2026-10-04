import type { RoomRow, RoomsRepo, RoomWrite } from '../../application/rooms/rooms-service';
import type { Db } from '../connection';

interface Row {
  id: number;
  name: string;
  code: string;
  block: string | null;
  floor: string | null;
  color: string;
  notes: string | null;
  directed_broadcast: string | null;
  batch_size: number | null;
  batch_delay_ms: number | null;
  created_at: number;
  updated_at: number;
  device_count: number;
}

const toRoom = (r: Row): RoomRow => ({
  id: r.id,
  name: r.name,
  code: r.code,
  block: r.block,
  floor: r.floor,
  color: r.color,
  notes: r.notes,
  directedBroadcast: r.directed_broadcast,
  batchSize: r.batch_size,
  batchDelaySeconds: r.batch_delay_ms === null ? null : r.batch_delay_ms / 1000,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deviceCount: r.device_count,
});

const SELECT = `SELECT r.*, (SELECT COUNT(*) FROM devices d WHERE d.room_id = r.id) AS device_count
  FROM rooms r`;

const params = (r: RoomWrite) => [
  r.name,
  r.code,
  r.block,
  r.floor,
  r.color,
  r.notes,
  r.directedBroadcast,
  r.batchSize,
  r.batchDelaySeconds === null ? null : Math.round(r.batchDelaySeconds * 1000),
];

export class SqliteRoomsRepo implements RoomsRepo {
  constructor(private readonly db: Db) {}

  list(): RoomRow[] {
    // Dashboard order (FR-004.5): block → floor → name; rooms without block last.
    return this.db
      .all<Row>(
        `${SELECT} ORDER BY r.block IS NULL, r.block COLLATE NOCASE, r.floor IS NULL,
           r.floor COLLATE NOCASE, r.name COLLATE NOCASE`,
      )
      .map(toRoom);
  }

  get(id: number): RoomRow | undefined {
    const r = this.db.get<Row>(`${SELECT} WHERE r.id = ?`, [id]);
    return r ? toRoom(r) : undefined;
  }

  codeTaken(code: string, exceptId = 0): boolean {
    return (
      this.db.get('SELECT 1 FROM rooms WHERE code = ? AND id != ?', [code, exceptId]) !== undefined
    );
  }

  nameTaken(name: string, exceptId = 0): boolean {
    return (
      this.db.get('SELECT 1 FROM rooms WHERE name = ? COLLATE NOCASE AND id != ?', [
        name,
        exceptId,
      ]) !== undefined
    );
  }

  insert(r: RoomWrite, now: number): number {
    return this.db.run(
      `INSERT INTO rooms (name, code, block, floor, color, notes, directed_broadcast, batch_size,
         batch_delay_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...params(r), now, now],
    ).lastInsertRowid;
  }

  update(id: number, r: RoomWrite, now: number): void {
    this.db.run(
      `UPDATE rooms SET name = ?, code = ?, block = ?, floor = ?, color = ?, notes = ?,
         directed_broadcast = ?, batch_size = ?, batch_delay_ms = ?, updated_at = ? WHERE id = ?`,
      [...params(r), now, id],
    );
  }

  delete(id: number): void {
    this.db.run('DELETE FROM rooms WHERE id = ?', [id]);
  }

  schedulesReferencing(id: number): { id: number; name: string }[] {
    return this.db.all<{ id: number; name: string }>(
      `SELECT DISTINCT s.id, s.name FROM schedules s JOIN schedule_targets t ON t.schedule_id = s.id
       WHERE t.type = 'room' AND t.ref_id = ? ORDER BY s.name`,
      [id],
    );
  }
}
