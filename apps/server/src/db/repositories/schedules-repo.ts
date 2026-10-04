import type { ScheduleException, ScheduleRun, ScheduleRunsQuery } from '@uniwake/shared';
import type {
  ScheduleRecord,
  SchedulesRepo,
  ScheduleWrite,
  TargetRow,
  TargetRowType,
} from '../../application/schedules/schedules-service';
import type { Db } from '../connection';

interface Row {
  id: number;
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
  updated_at: number;
}

export class SqliteSchedulesRepo implements SchedulesRepo {
  constructor(private readonly db: Db) {}

  private targetsOf(ids: readonly number[]): Map<number, TargetRow[]> {
    const rows = this.db.all<{ schedule_id: number; type: TargetRowType; ref_id: number | null }>(
      `SELECT schedule_id, type, ref_id FROM schedule_targets
       WHERE schedule_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
      [JSON.stringify(ids)],
    );
    const out = new Map<number, TargetRow[]>();
    for (const r of rows) {
      let list = out.get(r.schedule_id);
      if (!list) out.set(r.schedule_id, (list = []));
      list.push({ type: r.type, refId: r.ref_id });
    }
    return out;
  }

  private map(rows: Row[]): ScheduleRecord[] {
    const targets = this.targetsOf(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled === 1,
      weekdays: r.weekdays,
      timeLocal: r.time_local,
      timezone: r.timezone,
      onlyOffline: r.only_offline === 1,
      batchSize: r.batch_size,
      batchDelayMs: r.batch_delay_ms,
      confirmedCount: r.confirmed_count,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      targets: targets.get(r.id) ?? [],
    }));
  }

  list(): ScheduleRecord[] {
    return this.map(this.db.all<Row>('SELECT * FROM schedules ORDER BY time_local, name, id'));
  }

  get(id: number): ScheduleRecord | undefined {
    return this.map(this.db.all<Row>('SELECT * FROM schedules WHERE id = ?', [id]))[0];
  }

  private writeTargets(id: number, targets: readonly TargetRow[]) {
    this.db.run('DELETE FROM schedule_targets WHERE schedule_id = ?', [id]);
    for (const t of targets) {
      this.db.run('INSERT INTO schedule_targets (schedule_id, type, ref_id) VALUES (?, ?, ?)', [
        id,
        t.type,
        t.refId,
      ]);
    }
  }

  insert(s: ScheduleWrite, createdBy: number | null, now: number): number {
    const id = this.db.run(
      `INSERT INTO schedules (name, enabled, weekdays, time_local, timezone, only_offline, batch_size,
         batch_delay_ms, confirmed_count, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.name,
        s.enabled ? 1 : 0,
        s.weekdays,
        s.timeLocal,
        s.timezone,
        s.onlyOffline ? 1 : 0,
        s.batchSize,
        s.batchDelayMs,
        s.confirmedCount,
        createdBy,
        now,
        now,
      ],
    ).lastInsertRowid;
    this.writeTargets(id, s.targets);
    return id;
  }

  update(id: number, s: ScheduleWrite, now: number): void {
    this.db.run(
      `UPDATE schedules SET name = ?, enabled = ?, weekdays = ?, time_local = ?, timezone = ?,
         only_offline = ?, batch_size = ?, batch_delay_ms = ?, confirmed_count = ?, updated_at = ?
       WHERE id = ?`,
      [
        s.name,
        s.enabled ? 1 : 0,
        s.weekdays,
        s.timeLocal,
        s.timezone,
        s.onlyOffline ? 1 : 0,
        s.batchSize,
        s.batchDelayMs,
        s.confirmedCount,
        now,
        id,
      ],
    );
    this.writeTargets(id, s.targets);
  }

  delete(id: number): void {
    this.db.run('DELETE FROM schedules WHERE id = ?', [id]);
  }

  runs(q: ScheduleRunsQuery): { items: ScheduleRun[]; total: number } {
    const where = '(? IS NULL OR r.schedule_id = ?)';
    const p = [q.scheduleId ?? null, q.scheduleId ?? null];
    const total = this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM schedule_runs r WHERE ' + where,
      p,
    )!.n;
    const items = this.db.all<ScheduleRun>(
      'SELECT r.id, r.schedule_id AS scheduleId, s.name AS scheduleName, r.planned_at AS plannedAt, ' +
        'r.claimed_at AS handledAt, r.status, r.detail, r.job_id AS jobId ' +
        'FROM schedule_runs r JOIN schedules s ON s.id = r.schedule_id WHERE ' +
        where +
        ' ORDER BY r.planned_at DESC, r.id DESC LIMIT ? OFFSET ?',
      [...p, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return { items, total };
  }

  exceptions(): ScheduleException[] {
    return this.db.all<ScheduleException>(
      `SELECT id, schedule_id AS scheduleId, start_date AS startDate, end_date AS endDate, description
       FROM schedule_exceptions ORDER BY start_date, id`,
    );
  }

  insertException(e: Omit<ScheduleException, 'id'>): number {
    return this.db.run(
      'INSERT INTO schedule_exceptions (schedule_id, start_date, end_date, description) VALUES (?, ?, ?, ?)',
      [e.scheduleId, e.startDate, e.endDate, e.description],
    ).lastInsertRowid;
  }

  deleteException(id: number): ScheduleException | undefined {
    const e = this.exceptions().find((x) => x.id === id);
    if (e) this.db.run('DELETE FROM schedule_exceptions WHERE id = ?', [id]);
    return e;
  }
}
