/**
 * Replicated entities (ADR-031, plan §5.2): where each one lives and its snapshot, the full state a
 * peer needs, with references as UUIDs. Local ids, machine-local columns and lock-out counters are
 * never part of a snapshot. Key order is fixed, so equal states serialize to equal strings.
 */
import type { Db } from '../connection';

export const ROW_ENTITIES = [
  'user',
  'team_member',
  'room',
  'tag',
  'device',
  'schedule',
  'schedule_exception',
  'schedule_run',
] as const;
export type RowEntity = (typeof ROW_ENTITIES)[number];
export type EntityName = RowEntity | 'setting' | 'scheduler_pause';

/** Logging order for the baseline: referenced entities first (D6-04). */
export const BASELINE_ORDER: readonly RowEntity[] = ROW_ENTITIES;

export const TABLE: Record<RowEntity, string> = {
  user: 'users',
  team_member: 'team_members',
  room: 'rooms',
  tag: 'tags',
  device: 'devices',
  schedule: 'schedules',
  schedule_exception: 'schedule_exceptions',
  schedule_run: 'schedule_runs',
};

/** Tables that gained `updated_at` in migration 004: `touch` maintains it there (F6-03). */
export const TOUCH_SETS_UPDATED_AT: ReadonlySet<RowEntity> = new Set([
  'user',
  'team_member',
  'tag',
  'schedule_exception',
  'schedule_run',
]);

export const PAUSE_KEY = 'scheduler.pause';
export const PAUSE_ID = 'global';

/** Stored JSON as a value; text that is not JSON (a corrupt setting) travels as the raw string. */
const json = (v: string | null): unknown => {
  if (v === null) return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
};

const uuidOf = (db: Db, table: string, id: number | null): string | null =>
  id === null
    ? null
    : (db.get<{ uuid: string | null }>(`SELECT uuid FROM ${table} WHERE id = ?`, [id])?.uuid ??
      null);

type Snap = Record<string, unknown>;

const SNAPSHOT: Record<RowEntity, (db: Db, id: number) => Snap | undefined> = {
  user(db, id) {
    const r = db.get<{
      username: string;
      password_hash: string;
      role: string;
      enabled: number;
      created_at: number;
      password_changed_at: number;
    }>('SELECT * FROM users WHERE id = ?', [id]);
    return (
      r && {
        username: r.username,
        passwordHash: r.password_hash,
        role: r.role,
        enabled: r.enabled === 1,
        createdAt: r.created_at,
        passwordChangedAt: r.password_changed_at,
      }
    );
  },
  team_member(db, id) {
    const r = db.get<{
      name: string;
      verifier: string;
      joined_at: number;
      revoked_at: number | null;
    }>('SELECT name, verifier, joined_at, revoked_at FROM team_members WHERE id = ?', [id]);
    return (
      r && { name: r.name, verifier: r.verifier, joinedAt: r.joined_at, revokedAt: r.revoked_at }
    );
  },
  room(db, id) {
    const r = db.get<{
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
    }>('SELECT * FROM rooms WHERE id = ?', [id]);
    return (
      r && {
        name: r.name,
        code: r.code,
        block: r.block,
        floor: r.floor,
        color: r.color,
        notes: r.notes,
        directedBroadcast: r.directed_broadcast,
        batchSize: r.batch_size,
        batchDelayMs: r.batch_delay_ms,
        createdAt: r.created_at,
      }
    );
  },
  tag(db, id) {
    const r = db.get<{ name: string; color: string }>('SELECT name, color FROM tags WHERE id = ?', [
      id,
    ]);
    return r && { name: r.name, color: r.color };
  },
  device(db, id) {
    const r = db.get<{
      name: string;
      mac: string;
      ip: string | null;
      hostname: string | null;
      room_uuid: string | null;
      notes: string | null;
      enabled: number;
      manufacturer: string | null;
      model: string | null;
      serial: string | null;
      os: string | null;
      other_macs: string;
      prepared_at: number | null;
      prepare_results: string | null;
      enrolled_at: number | null;
      created_at: number;
    }>(
      `SELECT d.*, r.uuid AS room_uuid FROM devices d LEFT JOIN rooms r ON r.id = d.room_id
       WHERE d.id = ?`,
      [id],
    );
    if (!r) return undefined;
    const tags = db
      .all<{ uuid: string | null }>(
        'SELECT t.uuid FROM device_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.device_id = ?',
        [id],
      )
      .map((t) => t.uuid)
      .sort();
    return {
      name: r.name,
      mac: r.mac,
      ip: r.ip,
      hostname: r.hostname,
      room: r.room_uuid,
      notes: r.notes,
      enabled: r.enabled === 1,
      manufacturer: r.manufacturer,
      model: r.model,
      serial: r.serial,
      os: r.os,
      otherMacs: json(r.other_macs),
      preparedAt: r.prepared_at,
      prepareResults: json(r.prepare_results),
      enrolledAt: r.enrolled_at,
      createdAt: r.created_at,
      tags,
    };
  },
  schedule(db, id) {
    const r = db.get<{
      name: string;
      enabled: number;
      weekdays: number;
      time_local: string;
      timezone: string;
      only_offline: number;
      batch_size: number | null;
      batch_delay_ms: number | null;
      confirmed_count: number | null;
      created_by: number | null;
      created_at: number;
    }>('SELECT * FROM schedules WHERE id = ?', [id]);
    if (!r) return undefined;
    const targets = db
      .all<{ type: string; ref_uuid: string | null }>(
        'SELECT type, ref_uuid FROM schedule_targets WHERE schedule_id = ? ORDER BY rowid',
        [id],
      )
      .map((t) => ({ type: t.type, ref: t.ref_uuid }));
    return {
      name: r.name,
      enabled: r.enabled === 1,
      weekdays: r.weekdays,
      timeLocal: r.time_local,
      timezone: r.timezone,
      onlyOffline: r.only_offline === 1,
      batchSize: r.batch_size,
      batchDelayMs: r.batch_delay_ms,
      confirmedCount: r.confirmed_count,
      createdBy: uuidOf(db, 'users', r.created_by),
      createdAt: r.created_at,
      targets,
    };
  },
  schedule_exception(db, id) {
    const r = db.get<{
      schedule_id: number | null;
      start_date: string;
      end_date: string;
      description: string;
    }>('SELECT * FROM schedule_exceptions WHERE id = ?', [id]);
    return (
      r && {
        schedule: uuidOf(db, 'schedules', r.schedule_id),
        startDate: r.start_date,
        endDate: r.end_date,
        description: r.description,
      }
    );
  },
  schedule_run(db, id) {
    const r = db.get<{
      schedule_id: number;
      planned_at: number;
      claimed_at: number;
      status: string;
      detail: string | null;
      claimed_by_instance: string | null;
    }>('SELECT * FROM schedule_runs WHERE id = ?', [id]);
    return (
      r && {
        schedule: uuidOf(db, 'schedules', r.schedule_id),
        plannedAt: r.planned_at,
        claimedAt: r.claimed_at,
        status: r.status,
        detail: r.detail,
        claimedBy: r.claimed_by_instance,
      }
    );
  },
};

export function rowSnapshot(db: Db, entity: RowEntity, id: number): Snap | undefined {
  return SNAPSHOT[entity](db, id);
}

export function settingSnapshot(db: Db, key: string): Snap | undefined {
  const r = db.get<{ value: string; updated_by: number | null }>(
    'SELECT value, updated_by FROM settings WHERE key = ?',
    [key],
  );
  return r && { value: json(r.value), updatedBy: uuidOf(db, 'users', r.updated_by) };
}

export function pauseSnapshot(db: Db): Snap {
  const v = db.get<{ value: string }>('SELECT value FROM system_state WHERE key = ?', [PAUSE_KEY]);
  return { pause: v ? json(v.value) : null };
}
