import {
  type Device,
  type DeviceCompact,
  type DeviceStatus,
  isLocallyAdministered,
} from '@uniwake/shared';
import type {
  DeviceFilter,
  DevicesRepo,
  DeviceWrite,
} from '../../application/devices/devices-service';
import type { Db } from '../connection';

interface Row {
  id: number;
  name: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  room_id: number | null;
  notes: string | null;
  enabled: number;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  os: string | null;
  other_macs: string;
  prepared_at: number | null;
  enrolled_at: number | null;
  created_at: number;
  updated_at: number;
  status: DeviceStatus;
  latency_ms: number | null;
  last_seen_at: number | null;
  online_since: number | null;
  ever_online: number | null;
  tag_ids: string | null;
}

const tagIds = (s: string | null): number[] =>
  s
    ? s
        .split(',')
        .map(Number)
        .sort((a, b) => a - b)
    : [];

const toDevice = (r: Row): Device => ({
  id: r.id,
  name: r.name,
  mac: r.mac,
  ip: r.ip,
  hostname: r.hostname,
  roomId: r.room_id,
  tagIds: tagIds(r.tag_ids),
  notes: r.notes,
  enabled: r.enabled === 1,
  manufacturer: r.manufacturer,
  model: r.model,
  serial: r.serial,
  os: r.os,
  otherMacs: JSON.parse(r.other_macs) as string[],
  preparedAt: r.prepared_at,
  enrolledAt: r.enrolled_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  status: r.status,
  latencyMs: r.enabled === 1 ? r.latency_ms : null,
  lastSeenAt: r.last_seen_at,
  onlineSince: r.enabled === 1 ? r.online_since : null,
  everOnline: r.ever_online === 1,
  flags: {
    macLocallyAdministered: isLocallyAdministered(r.mac),
    neverResponded: r.ever_online !== 1,
  },
});

/** Disabled devices always read as `desconhecido` (AC-002-05). */
const STATUS_SQL = `CASE WHEN d.enabled = 0 THEN 'desconhecido' ELSE COALESCE(s.status, 'desconhecido') END`;

const SELECT = `SELECT d.*, ${STATUS_SQL} AS status, s.latency_ms, s.last_seen_at, s.online_since,
    s.ever_online,
    (SELECT GROUP_CONCAT(dt.tag_id) FROM device_tags dt WHERE dt.device_id = d.id) AS tag_ids
  FROM devices d LEFT JOIN device_state s ON s.device_id = d.id`;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereClause(f: DeviceFilter): { sql: string; params: Record<string, string | number> } {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (f.roomId === 'none') where.push('d.room_id IS NULL');
  else if (f.roomId !== undefined) {
    where.push('d.room_id = :roomId');
    params.roomId = f.roomId;
  }
  if (f.tagId !== undefined) {
    where.push(
      'EXISTS (SELECT 1 FROM device_tags x WHERE x.device_id = d.id AND x.tag_id = :tagId)',
    );
    params.tagId = f.tagId;
  }
  if (f.status !== undefined) {
    where.push(`${STATUS_SQL} = :status`);
    params.status = f.status;
  }
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    const parts = [
      "d.name LIKE :q ESCAPE '\\'",
      "d.ip LIKE :q ESCAPE '\\'",
      "d.hostname LIKE :q ESCAPE '\\'",
    ];
    params.q = like;
    // MAC search ignores separators: "aa-bb", "AA:BB" and "aabb" all match.
    const hex = f.q.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (hex.length >= 2 && /^[0-9a-fA-F:.\- ]+$/.test(f.q)) {
      parts.push("REPLACE(d.mac, ':', '') LIKE :hex");
      params.hex = `%${hex}%`;
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const ORDER = 'ORDER BY d.name COLLATE NOCASE, d.id';

export class SqliteDevicesRepo implements DevicesRepo {
  constructor(private readonly db: Db) {}

  get(id: number): Device | undefined {
    const r = this.db.get<Row>(`${SELECT} WHERE d.id = ?`, [id]);
    return r ? toDevice(r) : undefined;
  }

  findByMac(mac: string): { id: number; name: string } | undefined {
    return this.db.get<{ id: number; name: string }>('SELECT id, name FROM devices WHERE mac = ?', [
      mac,
    ]);
  }

  countByName(name: string, exceptId = 0): number {
    return (
      this.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM devices WHERE name = ? COLLATE NOCASE AND id != ?',
        [name, exceptId],
      )?.n ?? 0
    );
  }

  roomExists(id: number): boolean {
    return this.db.get('SELECT 1 FROM rooms WHERE id = ?', [id]) !== undefined;
  }

  missingTags(ids: readonly number[]): number[] {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const found = new Set(
      this.db
        .all<{ id: number }>(
          `SELECT id FROM tags WHERE id IN (${unique.map(() => '?').join(',')})`,
          unique,
        )
        .map((r) => r.id),
    );
    return unique.filter((id) => !found.has(id));
  }

  insert(d: DeviceWrite, now: number): number {
    const id = this.db.run(
      `INSERT INTO devices (name, mac, ip, hostname, room_id, notes, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.name, d.mac, d.ip, d.hostname, d.roomId, d.notes, d.enabled ? 1 : 0, now, now],
    ).lastInsertRowid;
    this.db.run('INSERT INTO device_state (device_id) VALUES (?)', [id]);
    return id;
  }

  update(id: number, d: DeviceWrite, now: number): void {
    this.db.run(
      `UPDATE devices SET name = ?, mac = ?, ip = ?, hostname = ?, room_id = ?, notes = ?, enabled = ?,
         updated_at = ? WHERE id = ?`,
      [d.name, d.mac, d.ip, d.hostname, d.roomId, d.notes, d.enabled ? 1 : 0, now, id],
    );
  }

  setTags(id: number, tagIdsToSet: readonly number[]): void {
    this.db.run('DELETE FROM device_tags WHERE device_id = ?', [id]);
    for (const t of new Set(tagIdsToSet)) {
      this.db.run('INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)', [id, t]);
    }
  }

  delete(id: number): void {
    this.db.run('DELETE FROM devices WHERE id = ?', [id]);
  }

  list(filter: DeviceFilter, limit: number, offset: number): { items: Device[]; total: number } {
    const w = whereClause(filter);
    const total =
      this.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM devices d LEFT JOIN device_state s ON s.device_id = d.id ${w.sql}`,
        w.params,
      )?.n ?? 0;
    const items = this.db
      .all<Row>(`${SELECT} ${w.sql} ${ORDER} LIMIT :limit OFFSET :offset`, {
        ...w.params,
        limit,
        offset,
      })
      .map(toDevice);
    return { items, total };
  }

  listCompact(filter: DeviceFilter, limit: number): DeviceCompact[] {
    const w = whereClause(filter);
    return this.db
      .all<Row>(`${SELECT} ${w.sql} ${ORDER} LIMIT :limit`, { ...w.params, limit })
      .map((r) => {
        const d = toDevice(r);
        return {
          id: d.id,
          name: d.name,
          mac: d.mac,
          ip: d.ip,
          hostname: d.hostname,
          roomId: d.roomId,
          tagIds: d.tagIds,
          enabled: d.enabled,
          status: d.status,
          latencyMs: d.latencyMs,
          lastSeenAt: d.lastSeenAt,
        };
      });
  }
}
