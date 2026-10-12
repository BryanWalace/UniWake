import type { AgentReport, WakeTarget } from '@uniwake/shared';
import type {
  AgentSighting,
  AgentStatus,
  AgentStore,
  PendingOrder,
} from '../../application/power/agent-service';
import type {
  JobOrderRow,
  JobRow,
  PowerDeviceInfo,
  PowerJobsStore,
} from '../../application/power/power-orders';
import type { ReportRow } from '../../application/power/power-status';
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
      }>(
        `SELECT uuid, action, warning_minutes, allow_postpone, postpone_max, postpone_minutes
         FROM power_orders
         WHERE device_id = ? AND state = 'pending' AND action <> 'cancel' AND expires_at > ?
         ORDER BY created_at, id`,
        [deviceId, now],
      )
      .map((o) => ({
        uuid: o.uuid,
        action: o.action,
        warningMinutes: o.warning_minutes,
        allowPostpone: o.allow_postpone === 1,
        postponeMax: o.postpone_max,
        postponeMinutes: o.postpone_minutes,
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
    job: Omit<JobRow, 'id' | 'createdBy'> & { target: WakeTarget; createdBy: number | null },
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
        JSON.stringify({ target: job.target, label: job.label }),
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
    }>(
      `SELECT r.occurrence_uuid, r.device_id, d.name, r.action, r.outcome, r.reason, r.planned_at,
         r.executed_at, r.postpones, r.was_asleep, r.late_minutes, r.native_warning, r.user_logged_on
       FROM power_reports r JOIN devices d ON d.id = r.device_id
       WHERE r.occurrence_uuid IS NOT NULL AND COALESCE(r.planned_at, r.received_at) >= ?
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
    }));
}

/** Boot time from the last check-in and tag UUIDs per device. */
export function deviceExtras(
  db: Db,
  ids: readonly number[],
): Map<number, { bootTime: number | null; tagUuids: string[] }> {
  const out = new Map<number, { bootTime: number | null; tagUuids: string[] }>();
  for (const id of ids) out.set(id, { bootTime: null, tagUuids: [] });
  const json = JSON.stringify(ids);
  for (const r of db.all<{ device_id: number; boot_time: number | null }>(
    'SELECT device_id, boot_time FROM agent_seen WHERE device_id IN (SELECT value FROM json_each(?))',
    [json],
  )) {
    out.get(r.device_id)!.bootTime = r.boot_time;
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
