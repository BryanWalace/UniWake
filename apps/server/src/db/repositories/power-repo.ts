import type { AgentReport } from '@uniwake/shared';
import type {
  AgentSighting,
  AgentStatus,
  AgentStore,
  PendingOrder,
} from '../../application/power/agent-service';
import type { AgendaDevice } from '../../domain/agenda';
import type { Db } from '../connection';

const OPEN = "('pending', 'delivered')";

/**
 * Power orders, reports and agent sightings (migration 006). Orders and reports are replicated in
 * team mode from M17-T06 on; until then they are written at rev 0 and baselined when registered.
 */
export class SqlitePowerRepo implements AgentStore {
  constructor(private readonly db: Db) {}

  insertReport(deviceId: number, r: AgentReport, receivedAt: number): boolean {
    return (
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
      ).changes > 0
    );
  }

  settleOrder(
    deviceId: number,
    orderUuid: string,
    state: 'executed' | 'cancelled' | 'failed' | 'expired',
    at: number,
    detail: string | null,
  ): void {
    this.db.run(
      `UPDATE power_orders SET state = ?, executed_at = ?, detail = ?
       WHERE uuid = ? AND device_id = ? AND state IN ${OPEN}`,
      [state, at, detail, orderUuid, deviceId],
    );
  }

  ackOrders(deviceId: number, uuids: readonly string[], at: number, instance: string): void {
    if (uuids.length === 0) return;
    this.db.run(
      `UPDATE power_orders SET state = 'delivered', delivered_at = ?, delivered_by_instance = ?
       WHERE device_id = ? AND state = 'pending' AND uuid IN (SELECT value FROM json_each(?))`,
      [at, instance, deviceId, JSON.stringify(uuids)],
    );
  }

  expireOrders(now: number): void {
    this.db.run(
      `UPDATE power_orders SET state = 'expired' WHERE state IN ${OPEN} AND expires_at <= ?`,
      [now],
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
    // Only a real change writes (and, once replicated, logs) the row.
    this.db.run(
      `UPDATE device_agents SET agent_version = ?, protocol = ?, freeze_product = ?, freeze_state = ?,
         persistent = ?, sleep_after_minutes = ?, wake_timers = ?, seen_coarse_at = ?
       WHERE device_id = ? AND NOT (
         agent_version IS ? AND protocol IS ? AND freeze_product IS ? AND freeze_state IS ?
         AND persistent = ? AND sleep_after_minutes IS ? AND wake_timers IS ? AND seen_coarse_at IS ?)`,
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
