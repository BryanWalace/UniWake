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
  // v1.3 (ADR-048), after what they reference.
  'device_agent',
  'power_job',
  'power_order',
  'power_report',
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
  device_agent: 'device_agents',
  power_job: 'power_jobs',
  power_order: 'power_orders',
  power_report: 'power_reports',
};

/** Tables that gained `updated_at` in migration 004: `touch` maintains it there (F6-03). */
export const TOUCH_SETS_UPDATED_AT: ReadonlySet<RowEntity> = new Set([
  'user',
  'team_member',
  'tag',
  'schedule_exception',
  'schedule_run',
  'device_agent',
  'power_job',
  'power_order',
  'power_report',
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

/** A stored list of UUIDs, sorted so equal sets serialize alike; anything else is an empty list. */
const sortedStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').sort() : [];

const uuidOf = (db: Db, table: string, id: number | null): string | null =>
  id === null
    ? null
    : (db.get<{ uuid: string | null }>(`SELECT uuid FROM ${table} WHERE id = ?`, [id])?.uuid ??
      null);

type Snap = Record<string, unknown>;

const SNAPSHOT: Record<RowEntity, (db: Db, id: number) => Snap | undefined> = {
  device_agent: (db, id) => POWER_SNAPSHOT.device_agent(db, id),
  power_job: (db, id) => POWER_SNAPSHOT.power_job(db, id),
  power_order: (db, id) => POWER_SNAPSHOT.power_order(db, id),
  power_report: (db, id) => POWER_SNAPSHOT.power_report(db, id),
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
      signing_key_id: string | null;
      signing_public_jwk: string | null;
    }>(
      `SELECT name, verifier, joined_at, revoked_at, signing_key_id, signing_public_jwk
       FROM team_members WHERE id = ?`,
      [id],
    );
    return (
      r && {
        name: r.name,
        verifier: r.verifier,
        joinedAt: r.joined_at,
        revokedAt: r.revoked_at,
        signingKeyId: r.signing_key_id,
        signingPublicKey: json(r.signing_public_jwk),
      }
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
      never_scheduled_shutdown: number;
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
      neverScheduledShutdown: r.never_scheduled_shutdown === 1,
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
      action: string;
      warning_minutes: number | null;
      allow_postpone: number | null;
      postpone_max: number | null;
      postpone_minutes: number | null;
      exclude_tags: string;
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
      action: r.action,
      warningMinutes: r.warning_minutes,
      allowPostpone: r.allow_postpone === null ? null : r.allow_postpone === 1,
      postponeMax: r.postpone_max,
      postponeMinutes: r.postpone_minutes,
      excludeTags: sortedStrings(json(r.exclude_tags)),
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

const bit = (v: number | null) => (v === null ? null : v === 1);

/** v1.3 replicated power entities (ADR-048). */
const POWER_SNAPSHOT = {
  device_agent(db: Db, id: number): Snap | undefined {
    const r = db.get<{
      device_uuid: string | null;
      token_hash: string | null;
      pending_token_hash: string | null;
      issued_at: number | null;
      rotated_at: number | null;
      revoked_at: number | null;
      agent_version: string | null;
      protocol: number | null;
      freeze_product: string | null;
      freeze_state: string | null;
      persistent: number;
      sleep_after_minutes: number | null;
      wake_timers: string | null;
      seen_coarse_at: number | null;
    }>(
      `SELECT a.*, d.uuid AS device_uuid FROM device_agents a JOIN devices d ON d.id = a.device_id
       WHERE a.id = ?`,
      [id],
    );
    return (
      r && {
        device: r.device_uuid,
        tokenHash: r.token_hash,
        pendingTokenHash: r.pending_token_hash,
        issuedAt: r.issued_at,
        rotatedAt: r.rotated_at,
        revokedAt: r.revoked_at,
        agentVersion: r.agent_version,
        protocol: r.protocol,
        freezeProduct: r.freeze_product,
        freezeState: r.freeze_state,
        persistent: r.persistent === 1,
        sleepAfterMinutes: r.sleep_after_minutes,
        wakeTimers: r.wake_timers,
        seenCoarseAt: r.seen_coarse_at,
      }
    );
  },
  power_job(db: Db, id: number): Snap | undefined {
    const r = db.get<{
      action: string;
      target: string;
      warning_minutes: number;
      allow_postpone: number;
      postpone_max: number;
      postpone_minutes: number;
      created_by: number | null;
      created_at: number;
    }>('SELECT * FROM power_jobs WHERE id = ?', [id]);
    return (
      r && {
        action: r.action,
        target: json(r.target),
        warningMinutes: r.warning_minutes,
        allowPostpone: r.allow_postpone === 1,
        postponeMax: r.postpone_max,
        postponeMinutes: r.postpone_minutes,
        createdBy: uuidOf(db, 'users', r.created_by),
        createdAt: r.created_at,
      }
    );
  },
  power_order(db: Db, id: number): Snap | undefined {
    const r = db.get<{
      job_uuid: string | null;
      device_uuid: string | null;
      action: string;
      warning_minutes: number;
      allow_postpone: number;
      postpone_max: number;
      postpone_minutes: number;
      state: string;
      created_at: number;
      expires_at: number;
      delivered_at: number | null;
      delivered_by_instance: string | null;
      executed_at: number | null;
      detail: string | null;
    }>(
      `SELECT o.*, j.uuid AS job_uuid, d.uuid AS device_uuid FROM power_orders o
       LEFT JOIN power_jobs j ON j.id = o.job_id JOIN devices d ON d.id = o.device_id WHERE o.id = ?`,
      [id],
    );
    return (
      r && {
        job: r.job_uuid,
        device: r.device_uuid,
        action: r.action,
        warningMinutes: r.warning_minutes,
        allowPostpone: r.allow_postpone === 1,
        postponeMax: r.postpone_max,
        postponeMinutes: r.postpone_minutes,
        state: r.state,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        deliveredAt: r.delivered_at,
        deliveredBy: r.delivered_by_instance,
        executedAt: r.executed_at,
        detail: r.detail,
      }
    );
  },
  power_report(db: Db, id: number): Snap | undefined {
    const r = db.get<{
      device_uuid: string | null;
      occurrence_uuid: string | null;
      order_uuid: string | null;
      action: string;
      outcome: string;
      reason: string | null;
      planned_at: number | null;
      executed_at: number | null;
      postpones: number;
      user_logged_on: number | null;
      session_count: number | null;
      was_asleep: number;
      late_minutes: number | null;
      native_warning: number;
      freeze_state: string | null;
      detail: string | null;
      received_at: number;
    }>(
      `SELECT r.*, d.uuid AS device_uuid FROM power_reports r JOIN devices d ON d.id = r.device_id
       WHERE r.id = ?`,
      [id],
    );
    return (
      r && {
        device: r.device_uuid,
        occurrence: r.occurrence_uuid,
        order: r.order_uuid,
        action: r.action,
        outcome: r.outcome,
        reason: r.reason,
        plannedAt: r.planned_at,
        executedAt: r.executed_at,
        postpones: r.postpones,
        userLoggedOn: bit(r.user_logged_on),
        sessions: r.session_count,
        wasAsleep: r.was_asleep === 1,
        lateMinutes: r.late_minutes,
        nativeWarning: r.native_warning === 1,
        freezeState: r.freeze_state,
        detail: r.detail,
        receivedAt: r.received_at,
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
