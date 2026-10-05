import type {
  DashboardTag,
  DeviceStatus,
  JobState,
  RoomLastAction,
  StatusCounts,
} from '@uniwake/shared';
import type {
  DashboardRepo,
  HistoryRow,
  RoomRow,
} from '../../application/dashboard/dashboard-service';
import type { StatusChange } from '../../domain/uptime';
import type { Db } from '../connection';

/** Disabled devices always read as `desconhecido` (AC-002-05). */
const STATUS_SQL = `CASE WHEN d.enabled = 0 THEN 'desconhecido' ELSE COALESCE(s.status, 'desconhecido') END`;

/** Optional id filter; ids travel as one JSON parameter so the statement text never varies. */
const ids = (column: string) => `(? IS NULL OR ${column} IN (SELECT value FROM json_each(?)))`;
const idParams = (list?: readonly number[]) => {
  const j = list ? JSON.stringify(list) : null;
  return [j, j];
};

export class SqliteDashboardRepo implements DashboardRepo {
  constructor(private readonly db: Db) {}

  statusCounts(): (StatusCounts & { roomId: number | null })[] {
    return this.db
      .all<{ room_id: number | null; status: DeviceStatus; n: number }>(
        `SELECT d.room_id, ${STATUS_SQL} AS status, COUNT(*) AS n
         FROM devices d LEFT JOIN device_state s ON s.device_id = d.id
         GROUP BY d.room_id, status`,
      )
      .reduce(
        (acc, r) => {
          let c = acc.find((x) => x.roomId === r.room_id);
          if (!c) {
            c = { roomId: r.room_id, online: 0, offline: 0, desconhecido: 0, total: 0 };
            acc.push(c);
          }
          c[r.status] += r.n;
          c.total += r.n;
          return acc;
        },
        [] as (StatusCounts & { roomId: number | null })[],
      );
  }

  rooms(): RoomRow[] {
    return this.db.all<RoomRow>('SELECT id, name, code, block, floor, color FROM rooms');
  }

  lastActions(): Map<number, RoomLastAction> {
    const rows = this.db.all<{
      room_id: number;
      job_id: number;
      source: RoomLastAction['source'];
      state: JobState;
      dry_run: number;
      at: number;
      total: number;
      woke: number;
      already_on: number;
      no_response: number;
      send_failed: number;
    }>(
      `WITH latest AS (
         SELECT room_id, MAX(job_id) AS job_id FROM wake_job_devices
         WHERE room_id IS NOT NULL GROUP BY room_id)
       SELECT l.room_id, j.id AS job_id, j.source, j.state, j.dry_run,
         COALESCE(j.started_at, j.created_at) AS at, COUNT(*) AS total,
         SUM(jd.result = 'acordou') AS woke, SUM(jd.result = 'ja_estava_ligado') AS already_on,
         SUM(jd.result = 'nao_respondeu') AS no_response, SUM(jd.result = 'falha_no_envio') AS send_failed
       FROM latest l
       JOIN wake_jobs j ON j.id = l.job_id
       JOIN wake_job_devices jd ON jd.job_id = l.job_id AND jd.room_id = l.room_id
       GROUP BY l.room_id`,
    );
    return new Map(
      rows.map((r) => [
        r.room_id,
        {
          jobId: r.job_id,
          source: r.source,
          state: r.state,
          dryRun: r.dry_run === 1,
          at: r.at,
          total: r.total,
          woke: r.woke,
          alreadyOn: r.already_on,
          noResponse: r.no_response,
          sendFailed: r.send_failed,
        },
      ]),
    );
  }

  tags(): DashboardTag[] {
    return this.db.all<DashboardTag>(
      `SELECT t.id, t.name, t.color, COUNT(dt.device_id) AS total
       FROM tags t LEFT JOIN device_tags dt ON dt.tag_id = t.id
       GROUP BY t.id ORDER BY t.name`,
    );
  }

  deviceExists(id: number): boolean {
    return this.db.get('SELECT 1 AS x FROM devices WHERE id = ?', [id]) !== undefined;
  }

  roomExists(id: number): boolean {
    return this.db.get('SELECT 1 AS x FROM rooms WHERE id = ?', [id]) !== undefined;
  }

  devicesFor(q: { deviceId?: number; roomId?: number }): { id: number; createdAt: number }[] {
    return this.db.all<{ id: number; createdAt: number }>(
      `SELECT id, created_at AS createdAt FROM devices
       WHERE (? IS NULL OR id = ?) AND (? IS NULL OR room_id = ?) ORDER BY id`,
      [q.deviceId ?? null, q.deviceId ?? null, q.roomId ?? null, q.roomId ?? null],
    );
  }

  devicesCreatedBefore(before: number): { id: number; createdAt: number }[] {
    return this.db.all<{ id: number; createdAt: number }>(
      'SELECT id, created_at AS createdAt FROM devices WHERE created_at < ? ORDER BY id',
      [before],
    );
  }

  statusBefore(at: number, deviceIds?: readonly number[]): Map<number, DeviceStatus> {
    const rows = this.db.all<{ device_id: number; status: DeviceStatus }>(
      `SELECT d.id AS device_id,
         (SELECT json_extract(e.data, '$.to') FROM device_events e
          WHERE e.device_id = d.id AND e.type = 'status' AND e.at < ?
          ORDER BY e.at DESC, e.id DESC LIMIT 1) AS status
       FROM devices d WHERE ${ids('d.id')}`,
      [at, ...idParams(deviceIds)],
    );
    return new Map(rows.filter((r) => r.status !== null).map((r) => [r.device_id, r.status]));
  }

  statusChanges(
    from: number,
    to: number,
    deviceIds?: readonly number[],
  ): Map<number, StatusChange[]> {
    const rows = this.db.all<{ device_id: number; at: number; status: DeviceStatus }>(
      `SELECT device_id, at, json_extract(data, '$.to') AS status FROM device_events
       WHERE type = 'status' AND at >= ? AND at < ? AND ${ids('device_id')}
       ORDER BY at, id`,
      [from, to, ...idParams(deviceIds)],
    );
    const out = new Map<number, StatusChange[]>();
    for (const r of rows) {
      let list = out.get(r.device_id);
      if (!list) out.set(r.device_id, (list = []));
      list.push({ at: r.at, to: r.status });
    }
    return out;
  }

  dailyUptime(deviceIds: readonly number[], fromDay: string, toDay: string): Map<string, number> {
    const rows = this.db.all<{ device_id: number; day: string; online_ms: number }>(
      `SELECT device_id, day, online_ms FROM daily_uptime
       WHERE day >= ? AND day <= ? AND ${ids('device_id')}`,
      [fromDay, toDay, ...idParams(deviceIds)],
    );
    return new Map(rows.map((r) => [`${r.device_id}|${r.day}`, r.online_ms]));
  }

  dailyUptimeTotals(
    deviceIds: readonly number[],
    fromDay: string,
    toDay: string,
  ): Map<string, { ms: number; n: number }> {
    const rows = this.db.all<{ day: string; ms: number; n: number }>(
      `SELECT day, SUM(online_ms) AS ms, COUNT(*) AS n FROM daily_uptime
       WHERE day >= ? AND day <= ? AND ${ids('device_id')} GROUP BY day`,
      [fromDay, toDay, ...idParams(deviceIds)],
    );
    return new Map(rows.map((r) => [r.day, { ms: r.ms, n: r.n }]));
  }

  upsertDailyUptime(rows: readonly { deviceId: number; day: string; onlineMs: number }[]): void {
    for (const r of rows) {
      this.db.run(
        `INSERT INTO daily_uptime (device_id, day, online_ms) VALUES (?, ?, ?)
         ON CONFLICT(device_id, day) DO UPDATE SET online_ms = excluded.online_ms`,
        [r.deviceId, r.day, Math.round(r.onlineMs)],
      );
    }
  }

  latestRolledDay(): string | null {
    return this.db.get<{ d: string | null }>('SELECT MAX(day) AS d FROM daily_uptime')?.d ?? null;
  }

  deviceHistory(
    deviceId: number,
    q: { before: number | null; limit: number } | { exactly: number },
  ): HistoryRow[] {
    const exact = 'exactly' in q;
    return this.db.all<HistoryRow>(
      `SELECT * FROM (
         SELECT 'event' AS src, e.id AS id, e.at AS at, e.type AS type, e.data AS data,
           NULL AS jobId, NULL AS source, NULL AS result, NULL AS dryRun, NULL AS wokeAt
         FROM device_events e WHERE e.device_id = ?
         UNION ALL
         SELECT 'wake', jd.job_id, COALESCE(jd.sent_at, j.started_at, j.created_at), 'wake', '{}',
           j.id, j.source, jd.result, j.dry_run, jd.woke_at
         FROM wake_job_devices jd JOIN wake_jobs j ON j.id = jd.job_id WHERE jd.device_id = ?
       )
       WHERE CASE WHEN ? THEN at = ? ELSE (? IS NULL OR at < ?) END
       ORDER BY at DESC, src, id DESC LIMIT ?`,
      exact
        ? [deviceId, deviceId, 1, q.exactly, null, null, -1]
        : [deviceId, deviceId, 0, null, q.before, q.before, q.limit],
    );
  }

  earliestDeviceCreatedAt(): number | null {
    return this.db.get<{ t: number | null }>('SELECT MIN(created_at) AS t FROM devices')?.t ?? null;
  }
}
