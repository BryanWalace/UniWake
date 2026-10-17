import type { AgentHealth, AgentReport, WakeTarget } from '@uniwake/shared';
import type {
  AgentSighting,
  AgentStatus,
  AgentStore,
  PendingOrder,
  StoredHealth,
} from '../../application/power/agent-service';
import type {
  JobOrderRow,
  JobRow,
  PowerDeviceInfo,
  PowerJobsStore,
} from '../../application/power/power-orders';
import type { DeviceExtras, ReportRow } from '../../application/power/power-status';
import type { ReconcileStore } from '../../application/power/reconcile';
import type { DiagnosticsStore } from '../../application/power/diagnostics';
import type { ShutdownTestRow, ShutdownTestStore } from '../../application/power/shutdown-test';
import type { AgendaDevice } from '../../domain/agenda';
import type { Db } from '../connection';
import { changeLog } from '../sync/change-log';
import { randomBytes } from 'node:crypto';
import type { DemoAgentStore } from '../../application/demo/demo-agents';
import { SqliteDeviceAgentsRepo } from './device-agents-repo';

const OPEN = "('pending', 'delivered')";

/** One machine with its agent, last check-in and monitor state (FR-309). */
export interface AgentDbRow {
  deviceId: number;
  name: string;
  roomId: number | null;
  neverScheduledShutdown: boolean;
  hasToken: boolean;
  issuedAt: number | null;
  rotatedAt: number | null;
  revokedAt: number | null;
  agentVersion: string | null;
  freezeProduct: string | null;
  freezeState: string | null;
  persistent: boolean;
  sleepAfterMinutes: number | null;
  wakeTimers: string | null;
  /** The newest of this hub's exact sighting and the team's coarse time (ADR-048). */
  lastCheckin: number | null;
  clockOffsetMs: number | null;
  userLoggedOn: boolean | null;
  sessions: number | null;
  status: string;
  onlineSince: number | null;
}

/** Every device (or the given ones) with what readiness and the panel show about its agent. */
export function agentRows(db: Db, deviceIds?: readonly number[]): AgentDbRow[] {
  const rows = db.all<{
    id: number;
    name: string;
    room_id: number | null;
    never_scheduled_shutdown: number;
    token_hash: string | null;
    issued_at: number | null;
    rotated_at: number | null;
    revoked_at: number | null;
    agent_version: string | null;
    freeze_product: string | null;
    freeze_state: string | null;
    persistent: number | null;
    sleep_after_minutes: number | null;
    wake_timers: string | null;
    seen_coarse_at: number | null;
    seen_at: number | null;
    clock_offset_ms: number | null;
    user_logged_on: number | null;
    session_count: number | null;
    status: string | null;
    online_since: number | null;
  }>(
    `SELECT d.id, d.name, d.room_id, d.never_scheduled_shutdown, a.token_hash, a.issued_at, a.rotated_at,
       a.revoked_at, a.agent_version, a.freeze_product, a.freeze_state, a.persistent,
       a.sleep_after_minutes, a.wake_timers, a.seen_coarse_at, s.seen_at, s.clock_offset_ms,
       s.user_logged_on, s.session_count, st.status, st.online_since
     FROM devices d
     LEFT JOIN device_agents a ON a.device_id = d.id
     LEFT JOIN agent_seen s ON s.device_id = d.id
     LEFT JOIN device_state st ON st.device_id = d.id
     ${deviceIds ? 'WHERE d.id IN (SELECT value FROM json_each(?))' : ''}
     ORDER BY d.name COLLATE NOCASE, d.id`,
    deviceIds ? [JSON.stringify(deviceIds)] : [],
  );
  return rows.map((r) => ({
    deviceId: r.id,
    name: r.name,
    roomId: r.room_id,
    neverScheduledShutdown: r.never_scheduled_shutdown === 1,
    hasToken: r.token_hash !== null,
    issuedAt: r.issued_at,
    rotatedAt: r.rotated_at,
    revokedAt: r.revoked_at,
    agentVersion: r.agent_version,
    freezeProduct: r.freeze_product,
    freezeState: r.freeze_state,
    persistent: r.persistent === 1,
    sleepAfterMinutes: r.sleep_after_minutes,
    wakeTimers: r.wake_timers,
    lastCheckin:
      r.seen_at === null && r.seen_coarse_at === null
        ? null
        : Math.max(r.seen_at ?? 0, r.seen_coarse_at ?? 0),
    clockOffsetMs: r.clock_offset_ms,
    userLoggedOn: r.user_logged_on === null ? null : r.user_logged_on === 1,
    sessions: r.session_count,
    status: r.status ?? 'desconhecido',
    onlineSince: r.online_since,
  }));
}

/**
 * Power orders, reports and agent sightings (migration 006). Orders, reports and the agent row are
 * replicated (ADR-048): every write is logged; `agent_seen` is machine-local.
 */
export class SqlitePowerRepo implements AgentStore {
  constructor(private readonly db: Db) {}

  private touchOrders(ids: readonly { id: number }[]): void {
    changeLog(this.db).touchAll(
      'power_order',
      ids.map((r) => r.id),
    );
  }

  insertReport(deviceId: number, r: AgentReport, receivedAt: number): boolean {
    const inserted =
      this.db.run(
        `INSERT INTO power_reports (uuid, device_id, occurrence_uuid, order_uuid, action, outcome, reason,
           planned_at, executed_at, postpones, user_logged_on, session_count, was_asleep, late_minutes,
           native_warning, freeze_state, detail, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uuid) DO NOTHING`,
        [
          r.uuid,
          deviceId,
          r.occurrence,
          r.order,
          r.action,
          r.outcome,
          r.reason,
          r.plannedAt,
          r.executedAt,
          r.postpones,
          r.userLoggedOn === null ? null : r.userLoggedOn ? 1 : 0,
          r.sessions,
          r.wasAsleep ? 1 : 0,
          r.lateMinutes,
          r.nativeWarning ? 1 : 0,
          r.freezeState,
          r.detail,
          receivedAt,
        ],
      ).changes > 0;
    if (inserted) {
      const id = this.db.get<{ id: number }>('SELECT id FROM power_reports WHERE uuid = ?', [
        r.uuid,
      ])!.id;
      changeLog(this.db).touch('power_report', id);
    }
    return inserted;
  }

  settleOrder(
    deviceId: number,
    orderUuid: string,
    state: 'executed' | 'cancelled' | 'failed' | 'expired',
    at: number,
    detail: string | null,
  ): void {
    this.touchOrders(
      this.db.all<{ id: number }>(
        `UPDATE power_orders SET state = ?, executed_at = ?, detail = ?
         WHERE uuid = ? AND device_id = ? AND state IN ${OPEN} RETURNING id`,
        [state, at, detail, orderUuid, deviceId],
      ),
    );
  }

  ackOrders(deviceId: number, uuids: readonly string[], at: number, instance: string): void {
    if (uuids.length === 0) return;
    this.touchOrders(
      this.db.all<{ id: number }>(
        `UPDATE power_orders SET state = 'delivered', delivered_at = ?, delivered_by_instance = ?
         WHERE device_id = ? AND state = 'pending' AND uuid IN (SELECT value FROM json_each(?))
         RETURNING id`,
        [at, instance, deviceId, JSON.stringify(uuids)],
      ),
    );
  }

  expireOrders(now: number): void {
    this.touchOrders(
      this.db.all<{ id: number }>(
        `UPDATE power_orders SET state = 'expired' WHERE state IN ${OPEN} AND expires_at <= ? RETURNING id`,
        [now],
      ),
    );
  }

  pendingOrders(deviceId: number, now: number): PendingOrder[] {
    return this.db
      .all<{
        uuid: string;
        action: 'shutdown' | 'restart';
        warning_minutes: number;
        allow_postpone: number;
        postpone_max: number;
        postpone_minutes: number;
        job_uuid: string | null;
        planned_at: number | null;
      }>(
        // ADR-053: the job's UUID is the run id (a schedule occurrence, or a manual job).
        `SELECT o.uuid, o.action, o.warning_minutes, o.allow_postpone, o.postpone_max,
           o.postpone_minutes, j.uuid AS job_uuid, json_extract(j.target, '$.plannedAt') AS planned_at
         FROM power_orders o LEFT JOIN power_jobs j ON j.id = o.job_id
         WHERE o.device_id = ? AND o.state = 'pending' AND o.action <> 'cancel' AND o.expires_at > ?
         ORDER BY o.created_at, o.id`,
        [deviceId, now],
      )
      .map((o) => ({
        uuid: o.uuid,
        action: o.action,
        warningMinutes: o.warning_minutes,
        allowPostpone: o.allow_postpone === 1,
        postponeMax: o.postpone_max,
        postponeMinutes: o.postpone_minutes,
        ...(o.job_uuid ? { occurrence: o.job_uuid } : {}),
        ...(typeof o.planned_at === 'number' ? { plannedAt: o.planned_at } : {}),
      }));
  }

  cancelledDelivered(deviceId: number, now: number): string[] {
    return this.db
      .all<{ uuid: string }>(
        `SELECT uuid FROM power_orders
         WHERE device_id = ? AND state = 'cancelled' AND delivered_at IS NOT NULL
           AND executed_at IS NULL AND expires_at > ?
         ORDER BY id`,
        [deviceId, now],
      )
      .map((r) => r.uuid);
  }

  saveSighting(deviceId: number, s: AgentSighting): void {
    this.db.run(
      `INSERT INTO agent_seen (device_id, seen_at, ip, boot_time, clock_offset_ms, user_logged_on, session_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET seen_at = excluded.seen_at, ip = excluded.ip,
         boot_time = excluded.boot_time, clock_offset_ms = excluded.clock_offset_ms,
         user_logged_on = excluded.user_logged_on, session_count = excluded.session_count`,
      [
        deviceId,
        s.seenAt,
        s.ip,
        s.bootTime,
        s.clockOffsetMs,
        s.userLoggedOn === null ? null : s.userLoggedOn ? 1 : 0,
        s.sessionCount,
      ],
    );
  }

  /** v1.6.0 (ADR-059): machine-local health; `antivirus: null` keeps the stored one. */
  saveHealth(deviceId: number, h: AgentHealth, at: number): StoredHealth | null {
    const before = readHealth(this.db, deviceId);
    this.db.run(
      `INSERT INTO agent_health (device_id, received_at, install_level, update_json, repairs_json,
         antivirus_json, antivirus_at, power_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (device_id) DO UPDATE SET received_at = excluded.received_at,
         install_level = excluded.install_level, update_json = excluded.update_json,
         repairs_json = excluded.repairs_json,
         antivirus_json = COALESCE(excluded.antivirus_json, agent_health.antivirus_json),
         antivirus_at = COALESCE(excluded.antivirus_at, agent_health.antivirus_at),
         power_json = excluded.power_json`,
      [
        deviceId,
        at,
        h.installLevel,
        h.update === null ? null : JSON.stringify(h.update),
        JSON.stringify(h.repairs),
        h.antivirus === null ? null : JSON.stringify(h.antivirus),
        h.antivirus === null ? null : at,
        h.power ? JSON.stringify(h.power) : null,
      ],
    );
    return before;
  }

  saveAlert(deviceId: number, file: string, at: number): void {
    this.db.run(
      `INSERT INTO agent_health (device_id, received_at, repairs_json, alert_file, alert_at)
       VALUES (?, ?, '[]', ?, ?)
       ON CONFLICT (device_id) DO UPDATE SET alert_file = excluded.alert_file,
         alert_at = excluded.alert_at`,
      [deviceId, at, file, at],
    );
  }

  saveAgendaServed(deviceId: number, version: string, items: number, at: number): string | null {
    const before =
      this.db.get<{ v: string | null }>(
        'SELECT agenda_version AS v FROM agent_seen WHERE device_id = ?',
        [deviceId],
      )?.v ?? null;
    this.db.run(
      'UPDATE agent_seen SET agenda_version = ?, agenda_items = ?, agenda_served_at = ? WHERE device_id = ?',
      [version, items, at, deviceId],
    );
    return before;
  }

  saveStatus(deviceId: number, s: AgentStatus): void {
    // Only a real change writes (and logs) the row: little change-log churn (ADR-048).
    const changed = this.db.all<{ id: number }>(
      `UPDATE device_agents SET agent_version = ?, protocol = ?, freeze_product = ?, freeze_state = ?,
         persistent = ?, sleep_after_minutes = ?, wake_timers = ?, seen_coarse_at = ?
       WHERE device_id = ? AND NOT (
         agent_version IS ? AND protocol IS ? AND freeze_product IS ? AND freeze_state IS ?
         AND persistent = ? AND sleep_after_minutes IS ? AND wake_timers IS ? AND seen_coarse_at IS ?)
       RETURNING id`,
      [
        s.agentVersion,
        s.protocol,
        s.freezeProduct,
        s.freezeState,
        s.persistent ? 1 : 0,
        s.sleepAfterMinutes,
        s.wakeTimers,
        s.seenCoarseAt,
        deviceId,
        s.agentVersion,
        s.protocol,
        s.freezeProduct,
        s.freezeState,
        s.persistent ? 1 : 0,
        s.sleepAfterMinutes,
        s.wakeTimers,
        s.seenCoarseAt,
      ],
    );
    changeLog(this.db).touchAll(
      'device_agent',
      changed.map((r) => r.id),
    );
  }

  /** What the agenda generator needs about one device (FR-303.1, FR-306.2). */
  agendaDevice(deviceId: number): AgendaDevice | undefined {
    const d = this.db.get<{
      id: number;
      room_id: number | null;
      enabled: number;
      never_scheduled_shutdown: number;
    }>('SELECT id, room_id, enabled, never_scheduled_shutdown FROM devices WHERE id = ?', [
      deviceId,
    ]);
    if (!d) return undefined;
    const tags = this.db.all<{ id: number; uuid: string | null }>(
      'SELECT t.id, t.uuid FROM device_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.device_id = ?',
      [deviceId],
    );
    return {
      id: d.id,
      roomId: d.room_id,
      tagIds: tags.map((t) => t.id),
      tagUuids: tags.flatMap((t) => (t.uuid ? [t.uuid] : [])),
      enabled: d.enabled === 1,
      neverScheduledShutdown: d.never_scheduled_shutdown === 1,
    };
  }

  /** Highest change-log sequence: changes whenever any replicated data change. */
  dataVersion(): number {
    return this.db.get<{ s: number | null }>('SELECT MAX(seq) AS s FROM change_log')?.s ?? 0;
  }
}

/** Manual shutdown/restart jobs (FR-305) over `power_jobs` and `power_orders`. */
export class SqlitePowerJobsRepo implements PowerJobsStore {
  constructor(private readonly db: Db) {}

  info(deviceIds: readonly number[]): Map<number, PowerDeviceInfo> {
    return new Map(
      agentRows(this.db, deviceIds).map((r) => [
        r.deviceId,
        {
          hasToken: r.hasToken,
          revoked: r.revokedAt !== null,
          lastCheckin: r.lastCheckin,
          online: r.status === 'online',
          onlineSince: r.onlineSince,
          userLoggedOn: r.userLoggedOn,
          neverScheduledShutdown: r.neverScheduledShutdown,
        },
      ]),
    );
  }

  createJob(
    job: Omit<JobRow, 'id' | 'createdBy'> & {
      target: WakeTarget;
      createdBy: number | null;
      plannedAt?: number;
    },
    orders: { uuid: string; deviceId: number; expiresAt: number }[],
  ): number {
    const p = job.policy;
    const id = this.db.run(
      `INSERT INTO power_jobs (uuid, action, target, warning_minutes, allow_postpone, postpone_max,
         postpone_minutes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.uuid,
        job.action,
        // v1.6: a pushed schedule occurrence also keeps its planned time (T) for the orders.
        JSON.stringify({
          target: job.target,
          label: job.label,
          ...(job.plannedAt !== undefined ? { plannedAt: job.plannedAt } : {}),
        }),
        p.warningMinutes,
        p.allowPostpone ? 1 : 0,
        p.postponeMax,
        p.postponeMinutes,
        job.createdBy,
        job.createdAt,
      ],
    ).lastInsertRowid;
    changeLog(this.db).touch('power_job', id);
    for (const o of orders) {
      const orderId = this.db.run(
        `INSERT INTO power_orders (uuid, job_id, device_id, action, warning_minutes, allow_postpone,
           postpone_max, postpone_minutes, state, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [
          o.uuid,
          id,
          o.deviceId,
          job.action,
          p.warningMinutes,
          p.allowPostpone ? 1 : 0,
          p.postponeMax,
          p.postponeMinutes,
          job.createdAt,
          o.expiresAt,
        ],
      ).lastInsertRowid;
      changeLog(this.db).touch('power_order', orderId);
    }
    return id;
  }

  jobIdByUuid(uuid: string): number | null {
    return (
      this.db.get<{ id: number }>('SELECT id FROM power_jobs WHERE uuid = ?', [uuid])?.id ?? null
    );
  }

  addOrder(jobId: number, o: { uuid: string; deviceId: number; expiresAt: number }): boolean {
    if (this.db.get('SELECT 1 FROM power_orders WHERE uuid = ?', [o.uuid])) return false;
    const j = this.db.get<{
      action: string;
      warning_minutes: number;
      allow_postpone: number;
      postpone_max: number;
      postpone_minutes: number;
    }>(
      'SELECT action, warning_minutes, allow_postpone, postpone_max, postpone_minutes FROM power_jobs WHERE id = ?',
      [jobId],
    );
    if (!j) return false;
    const now = Date.now();
    const orderId = this.db.run(
      `INSERT INTO power_orders (uuid, job_id, device_id, action, warning_minutes, allow_postpone,
         postpone_max, postpone_minutes, state, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        o.uuid,
        jobId,
        o.deviceId,
        j.action,
        j.warning_minutes,
        j.allow_postpone,
        j.postpone_max,
        j.postpone_minutes,
        Math.min(now, o.expiresAt),
        o.expiresAt,
      ],
    ).lastInsertRowid;
    changeLog(this.db).touch('power_order', orderId);
    return true;
  }

  job(id: number): JobRow | undefined {
    const r = this.db.get<{
      id: number;
      uuid: string;
      action: 'shutdown' | 'restart';
      target: string;
      warning_minutes: number;
      allow_postpone: number;
      postpone_max: number;
      postpone_minutes: number;
      created_at: number;
      username: string | null;
    }>(
      `SELECT j.*, u.username FROM power_jobs j LEFT JOIN users u ON u.id = j.created_by
       WHERE j.id = ?`,
      [id],
    );
    if (!r) return undefined;
    const stored = JSON.parse(r.target) as { label?: string };
    return {
      id: r.id,
      uuid: r.uuid,
      action: r.action,
      label: stored.label ?? '',
      policy: {
        warningMinutes: r.warning_minutes,
        allowPostpone: r.allow_postpone === 1,
        postponeMax: r.postpone_max,
        postponeMinutes: r.postpone_minutes,
      },
      createdAt: r.created_at,
      createdBy: r.username,
    };
  }

  jobOrders(id: number): JobOrderRow[] {
    return this.db
      .all<{
        device_id: number;
        name: string;
        state: JobOrderRow['state'];
        expires_at: number;
        executed_at: number | null;
        detail: string | null;
        postpones: number | null;
        status: string | null;
        online_since: number | null;
      }>(
        `SELECT o.device_id, d.name, o.state, o.expires_at, o.executed_at, o.detail,
           (SELECT MAX(r.postpones) FROM power_reports r WHERE r.order_uuid = o.uuid) AS postpones,
           st.status, st.online_since
         FROM power_orders o
         JOIN devices d ON d.id = o.device_id
         LEFT JOIN device_state st ON st.device_id = o.device_id
         WHERE o.job_id = ? ORDER BY d.name COLLATE NOCASE, o.id`,
        [id],
      )
      .map((r) => ({
        deviceId: r.device_id,
        name: r.name,
        state: r.state,
        expiresAt: r.expires_at,
        executedAt: r.executed_at,
        detail: r.detail,
        postpones: r.postpones ?? 0,
        status: r.status ?? 'desconhecido',
        onlineSince: r.online_since,
      }));
  }

  cancelJob(id: number, at: number): number {
    const ids = this.db.all<{ id: number }>(
      `UPDATE power_orders SET state = 'cancelled', detail = 'cancelado no painel', executed_at = NULL
       WHERE job_id = ? AND state IN ('pending', 'delivered') AND expires_at > ? RETURNING id`,
      [id, at],
    );
    changeLog(this.db).touchAll(
      'power_order',
      ids.map((r) => r.id),
    );
    return ids.length;
  }
}

/** Reports of scheduled occurrences planned since `since` (FR-307), oldest first. */
export function occurrenceReports(db: Db, since: number): ReportRow[] {
  return db
    .all<{
      occurrence_uuid: string;
      device_id: number;
      name: string;
      action: 'shutdown' | 'restart';
      outcome: ReportRow['outcome'];
      reason: string | null;
      planned_at: number | null;
      executed_at: number | null;
      postpones: number;
      was_asleep: number;
      late_minutes: number | null;
      native_warning: number;
      user_logged_on: number | null;
      order_uuid: string | null;
    }>(
      `SELECT r.occurrence_uuid, r.device_id, d.name, r.action, r.outcome, r.reason, r.planned_at,
         r.executed_at, r.postpones, r.was_asleep, r.late_minutes, r.native_warning, r.user_logged_on,
         r.order_uuid
       FROM power_reports r JOIN devices d ON d.id = r.device_id
       WHERE r.occurrence_uuid IS NOT NULL AND COALESCE(r.planned_at, r.received_at) >= ?
         -- ADR-053: "already ran from the agenda" settles a pushed order; the agenda report counts.
         AND COALESCE(r.reason, '') <> 'already_done'
       ORDER BY COALESCE(r.planned_at, r.received_at), r.id`,
      [since],
    )
    .map((r) => ({
      occurrence: r.occurrence_uuid,
      deviceId: r.device_id,
      deviceName: r.name,
      action: r.action,
      outcome: r.outcome,
      reason: r.reason,
      plannedAt: r.planned_at,
      executedAt: r.executed_at,
      postpones: r.postpones,
      wasAsleep: r.was_asleep === 1,
      lateMinutes: r.late_minutes,
      nativeWarning: r.native_warning === 1,
      userLoggedOn: r.user_logged_on === null ? null : r.user_logged_on === 1,
      order: r.order_uuid,
    }));
}

/** Boot time from the last check-in and tag UUIDs per device. */
export function deviceExtras(db: Db, ids: readonly number[]): Map<number, DeviceExtras> {
  const out = new Map<number, DeviceExtras>();
  for (const id of ids) out.set(id, { bootTime: null, tagUuids: [], agendaItems: null });
  const json = JSON.stringify(ids);
  for (const r of db.all<{
    device_id: number;
    boot_time: number | null;
    agenda_items: number | null;
  }>(
    'SELECT device_id, boot_time, agenda_items FROM agent_seen WHERE device_id IN (SELECT value FROM json_each(?))',
    [json],
  )) {
    out.get(r.device_id)!.bootTime = r.boot_time;
    out.get(r.device_id)!.agendaItems = r.agenda_items;
  }
  for (const r of db.all<{ device_id: number; uuid: string | null }>(
    `SELECT dt.device_id, t.uuid FROM device_tags dt JOIN tags t ON t.id = dt.tag_id
     WHERE dt.device_id IN (SELECT value FROM json_each(?))`,
    [json],
  )) {
    if (r.uuid) out.get(r.device_id)!.tagUuids.push(r.uuid);
  }
  return out;
}

/** v1.6 (ADR-053): occurrences the hub pushed since `since` (job UUID = occurrence, with T). */
interface HealthRow {
  device_id: number;
  received_at: number;
  install_level: number | null;
  update_json: string | null;
  repairs_json: string | null;
  antivirus_json: string | null;
  antivirus_at: number | null;
  alert_file: string | null;
  alert_at: number | null;
  power_json: string | null;
}

/** v1.6.0 (ADR-059): what the hub keeps of a machine's health, or null. */
export function readHealth(db: Db, deviceId: number): StoredHealth | null {
  const r = db.get<HealthRow>('SELECT * FROM agent_health WHERE device_id = ?', [deviceId]);
  return r ? healthOf(r) : null;
}

/** Every machine's stored health in one query (device list marks). */
export function readAllHealth(db: Db): Map<number, StoredHealth> {
  return new Map(
    db.all<HealthRow>('SELECT * FROM agent_health').map((r) => [r.device_id, healthOf(r)]),
  );
}

function healthOf(r: HealthRow): StoredHealth {
  const parse = <T>(text: string | null, fallback: T): T => {
    if (text === null) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  };
  return {
    installLevel: r.install_level,
    update: parse<StoredHealth['update']>(r.update_json, null),
    repairs: parse<StoredHealth['repairs']>(r.repairs_json, []),
    antivirus: parse<StoredHealth['antivirus']>(r.antivirus_json, null),
    antivirusAt: r.antivirus_at,
    alert:
      r.alert_file !== null && r.alert_at !== null ? { file: r.alert_file, at: r.alert_at } : null,
    power: parse<StoredHealth['power']>(r.power_json, null),
    receivedAt: r.received_at,
  };
}

export function pushedOccurrences(
  db: Db,
  since: number,
): { occurrence: string; plannedAt: number }[] {
  return db.all<{ occurrence: string; plannedAt: number }>(
    "SELECT uuid AS occurrence, json_extract(target, '$.plannedAt') AS plannedAt FROM power_jobs WHERE json_extract(target, '$.plannedAt') >= ?",
    [since],
  );
}

/** v1.6 (ADR-054): per machine, the state and postpones of an occurrence's pushed orders. */
export function occurrenceOrders(
  db: Db,
  occurrence: string,
): Map<number, { state: string; postpones: number }> {
  const out = new Map<number, { state: string; postpones: number }>();
  for (const r of db.all<{ device_id: number; state: string; postpones: number }>(
    'SELECT o.device_id, o.state, 0 AS postpones FROM power_orders o JOIN power_jobs j ON j.id = o.job_id WHERE j.uuid = ? ORDER BY o.id',
    [occurrence],
  )) {
    const prev = out.get(r.device_id);
    // A retry order (ADR-054) after the first: the most advanced state wins.
    if (!prev || prev.state === 'pending')
      out.set(r.device_id, {
        state: r.state,
        postpones: Math.max(r.postpones, prev?.postpones ?? 0),
      });
  }
  return out;
}

/** FR-504.3 (ADR-056): the machine-local "Testar agendamento" one-offs. */
export class SqliteShutdownTestsStore implements ShutdownTestStore {
  constructor(private readonly db: Db) {}

  insert(t: {
    uuid: string;
    deviceId: number;
    at: number;
    warningMinutes: number;
    createdBy: number | null;
    createdAt: number;
  }): void {
    this.db.run(
      'INSERT INTO power_tests (uuid, device_id, at, warning_minutes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [t.uuid, t.deviceId, t.at, t.warningMinutes, t.createdBy, t.createdAt],
    );
  }

  since(since: number, deviceId?: number): ShutdownTestRow[] {
    return this.db.all<ShutdownTestRow>(
      `SELECT t.id, t.uuid, t.device_id AS deviceId, d.name AS deviceName, t.at,
              t.warning_minutes AS warningMinutes, t.created_at AS createdAt,
              t.pushed_at AS pushedAt, t.reconciled_at AS reconciledAt
       FROM power_tests t JOIN devices d ON d.id = t.device_id
       WHERE t.at >= ? AND (? IS NULL OR t.device_id = ?)
       ORDER BY t.at, t.id`,
      [since, deviceId ?? null, deviceId ?? null],
    );
  }

  markPushed(id: number, at: number): void {
    this.db.run('UPDATE power_tests SET pushed_at = ? WHERE id = ?', [at, id]);
  }

  markReconciled(id: number, occurrence: string, at: number, counts: Record<string, number>): void {
    this.db.transaction(() => {
      this.db.run('UPDATE power_tests SET reconciled_at = ? WHERE id = ?', [at, id]);
      this.db.run(
        'INSERT OR IGNORE INTO power_reconciled (occurrence, reconciled_at, counts) VALUES (?, ?, ?)',
        [occurrence, at, JSON.stringify(counts)],
      );
    });
  }
}

/** FR-504.1 (ADR-056): what the device diagnostics read. */
export class SqliteDiagnosticsStore implements DiagnosticsStore {
  constructor(private readonly db: Db) {}

  served(deviceId: number) {
    const r = this.db.get<{ version: string | null; items: number | null; at: number | null }>(
      'SELECT agenda_version AS version, agenda_items AS items, agenda_served_at AS at FROM agent_seen WHERE device_id = ?',
      [deviceId],
    );
    return r ?? null;
  }

  lastReport(deviceId: number) {
    return (
      this.db.get<{
        at: number;
        outcome: ReportRow['outcome'];
        reason: string | null;
        order: string | null;
        detail: string | null;
      }>(
        `SELECT COALESCE(executed_at, received_at) AS at, outcome, reason, order_uuid AS "order", detail
         FROM power_reports WHERE device_id = ? AND COALESCE(reason, '') <> 'already_done'
         ORDER BY COALESCE(executed_at, received_at) DESC, id DESC LIMIT 1`,
        [deviceId],
      ) ?? null
    );
  }

  scheduleName(id: number): string | null {
    return (
      this.db.get<{ name: string }>('SELECT name FROM schedules WHERE id = ?', [id])?.name ?? null
    );
  }

  deviceExists(id: number): boolean {
    return this.db.get('SELECT 1 FROM devices WHERE id = ?', [id]) !== undefined;
  }
}

/** ADR-054: what the reconciliation of scheduled shutdowns reads and writes. */
export class SqliteReconcileStore implements ReconcileStore {
  constructor(private readonly db: Db) {}

  pushedRuns(from: number, to: number) {
    // Only the runs this hub claimed: the hub that pushed reconciles and retries (one per run).
    return this.db.all<{ runId: number; scheduleId: number; plannedAt: number }>(
      `SELECT r.id AS runId, r.schedule_id AS scheduleId, r.planned_at AS plannedAt
       FROM schedule_runs r JOIN schedules s ON s.id = r.schedule_id
       WHERE s.action = 'shutdown' AND r.status IN ('executado', 'atrasado')
         AND r.planned_at BETWEEN ? AND ?
         AND (r.claimed_by_instance IS NULL OR r.claimed_by_instance = ?)
       ORDER BY r.planned_at`,
      [from, to, changeLog(this.db).instanceId()],
    );
  }

  isReconciled(occurrence: string): boolean {
    return (
      this.db.get('SELECT 1 FROM power_reconciled WHERE occurrence = ?', [occurrence]) !== undefined
    );
  }

  markReconciled(occurrence: string, at: number, counts: Record<string, number>): void {
    this.db.run(
      'INSERT OR IGNORE INTO power_reconciled (occurrence, reconciled_at, counts) VALUES (?, ?, ?)',
      [occurrence, at, JSON.stringify(counts)],
    );
  }

  appendRunDetail(runId: number, text: string): void {
    this.db.transaction(() => {
      this.db.run(
        "UPDATE schedule_runs SET detail = substr(COALESCE(detail, '') || ?, 1, 1000) WHERE id = ?",
        [text, runId],
      );
      changeLog(this.db).touch('schedule_run', runId);
    });
  }
}

export function recentPowerJobIds(db: Db, limit: number): number[] {
  return db
    .all<{ id: number }>('SELECT id FROM power_jobs ORDER BY created_at DESC, id DESC LIMIT ?', [
      limit,
    ])
    .map((r) => r.id);
}

/** Demo mode only (FR-310): the store the simulated agents use, over the real tables. */
export class SqliteDemoAgentStore extends SqlitePowerRepo implements DemoAgentStore {
  private readonly agents: SqliteDeviceAgentsRepo;

  constructor(private readonly demoDb: Db) {
    super(demoDb);
    this.agents = new SqliteDeviceAgentsRepo(demoDb);
  }

  devices(): { id: number; name: string; mac: string }[] {
    return this.demoDb.all<{ id: number; name: string; mac: string }>(
      'SELECT id, name, mac FROM devices WHERE enabled = 1 ORDER BY id',
    );
  }

  hasAgent(deviceId: number): boolean {
    return this.agents.byDevice(deviceId) !== undefined;
  }

  issue(deviceId: number, now: number): void {
    // A token nobody holds: the simulated agent does not use HTTP.
    this.agents.issue(deviceId, randomBytes(32).toString('hex'), now);
  }

  orderState(uuid: string): string | null {
    return (
      this.demoDb.get<{ state: string }>('SELECT state FROM power_orders WHERE uuid = ?', [uuid])
        ?.state ?? null
    );
  }

  jobOf(orderUuid: string): number | null {
    return (
      this.demoDb.get<{ job_id: number | null }>('SELECT job_id FROM power_orders WHERE uuid = ?', [
        orderUuid,
      ])?.job_id ?? null
    );
  }
}
