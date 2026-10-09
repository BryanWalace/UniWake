import type { DeviceStatus } from '@uniwake/shared';
import type {
  DeviceEvent,
  MonitorRepo,
  ProbeTarget,
  StatusUpdate,
} from '../../application/monitor/monitor-service';
import type { Db } from '../connection';
import { changeLog } from '../sync/change-log';

interface Row {
  id: number;
  ip: string | null;
  hostname: string | null;
  enabled: number;
  status: DeviceStatus | null;
  latency_ms: number | null;
  last_seen_at: number | null;
  online_since: number | null;
  last_probe_at: number | null;
  consecutive_failures: number | null;
  ever_online: number | null;
}

export class SqliteMonitorRepo implements MonitorRepo {
  constructor(private readonly db: Db) {}

  targets(deviceIds?: readonly number[]): ProbeTarget[] {
    const ids = deviceIds ? JSON.stringify(deviceIds) : null;
    return this.db
      .all<Row>(
        `SELECT d.id, d.ip, d.hostname, d.enabled, s.status, s.latency_ms, s.last_seen_at, s.online_since,
           s.last_probe_at, s.consecutive_failures, s.ever_online
         FROM devices d LEFT JOIN device_state s ON s.device_id = d.id
         WHERE (? IS NULL OR d.id IN (SELECT value FROM json_each(?)))
         ORDER BY d.id`,
        [ids, ids],
      )
      .map((r) => ({
        deviceId: r.id,
        ip: r.ip,
        hostname: r.hostname,
        enabled: r.enabled === 1,
        state: {
          status: r.status ?? 'desconhecido',
          latencyMs: r.latency_ms,
          lastSeenAt: r.last_seen_at,
          onlineSince: r.online_since,
          lastProbeAt: r.last_probe_at,
          consecutiveFailures: r.consecutive_failures ?? 0,
          everOnline: r.ever_online === 1,
        },
      }));
  }

  /** Devices deleted while a sweep was probing are skipped (M4-F1), never a constraint error. */
  saveStates(updates: readonly StatusUpdate[]): void {
    for (const { deviceId, state: s } of updates) {
      this.db.run(
        `INSERT INTO device_state (device_id, status, latency_ms, last_seen_at, online_since, last_probe_at,
           consecutive_failures, ever_online)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM devices WHERE id = ?1)
         ON CONFLICT(device_id) DO UPDATE SET status = excluded.status, latency_ms = excluded.latency_ms,
           last_seen_at = excluded.last_seen_at, online_since = excluded.online_since,
           last_probe_at = excluded.last_probe_at, consecutive_failures = excluded.consecutive_failures,
           ever_online = excluded.ever_online`,
        [
          deviceId,
          s.status,
          s.latencyMs,
          s.lastSeenAt,
          s.onlineSince,
          s.lastProbeAt,
          s.consecutiveFailures,
          s.everOnline ? 1 : 0,
        ],
      );
    }
  }

  insertEvents(events: readonly DeviceEvent[]): void {
    for (const e of events) {
      this.db.run(
        `INSERT INTO device_events (device_id, at, type, data)
         SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM devices WHERE id = ?1)`,
        [e.deviceId, e.at, e.type, JSON.stringify(e.data)],
      );
    }
  }

  updateIp(deviceId: number, ip: string, now: number): void {
    this.db.run('UPDATE devices SET ip = ?, updated_at = ? WHERE id = ?', [ip, now, deviceId]);
    changeLog(this.db).touch('device', deviceId);
  }

  resetAllUnknown(): { deviceId: number; from: DeviceStatus; lastProbeAt: number | null }[] {
    const cleared = this.db
      .all<{ device_id: number; status: DeviceStatus; last_probe_at: number | null }>(
        "SELECT device_id, status, last_probe_at FROM device_state WHERE status <> 'desconhecido' ORDER BY device_id",
      )
      .map((r) => ({ deviceId: r.device_id, from: r.status, lastProbeAt: r.last_probe_at }));
    // last_seen_at and ever_online survive: "visto há 3 h" and "nunca respondeu" stay true (AC-004-12).
    this.db.run(
      "UPDATE device_state SET status = 'desconhecido', latency_ms = NULL, online_since = NULL, consecutive_failures = 0",
    );
    return cleared;
  }
}
