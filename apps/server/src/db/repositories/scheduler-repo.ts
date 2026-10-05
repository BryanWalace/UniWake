import type {
  PauseState,
  SchedulerRepo,
  StoredRunStatus,
} from '../../application/schedules/scheduler';
import type { ScheduleRecord } from '../../application/schedules/schedules-service';
import type { Db } from '../connection';
import { SqliteSchedulesRepo } from './schedules-repo';

const LAST_TICK = 'scheduler.lastTickAt';
const PAUSE = 'scheduler.pause';

export class SqliteSchedulerRepo implements SchedulerRepo {
  private readonly schedules: SqliteSchedulesRepo;

  constructor(private readonly db: Db) {
    this.schedules = new SqliteSchedulesRepo(db);
  }

  enabledSchedules(): ScheduleRecord[] {
    return this.schedules.list().filter((s) => s.enabled);
  }

  exceptions() {
    return this.schedules.exceptions();
  }

  claim(
    scheduleId: number,
    plannedAt: number,
    claimedAt: number,
    status: StoredRunStatus,
    detail: string | null,
  ): number | null {
    const r = this.db.run(
      `INSERT INTO schedule_runs (schedule_id, planned_at, claimed_at, status, detail)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(schedule_id, planned_at) DO NOTHING`,
      [scheduleId, plannedAt, claimedAt, status, detail],
    );
    return r.changes === 1 ? r.lastInsertRowid : null;
  }

  finish(
    runId: number,
    status: StoredRunStatus,
    detail: string | null,
    jobId: number | null,
  ): void {
    this.db.run('UPDATE schedule_runs SET status = ?, detail = ?, job_id = ? WHERE id = ?', [
      status,
      detail,
      jobId,
      runId,
    ]);
  }

  runInfo(runId: number) {
    return this.db.get<{ scheduleId: number; scheduleName: string; plannedAt: number }>(
      `SELECT r.schedule_id AS scheduleId, s.name AS scheduleName, r.planned_at AS plannedAt
       FROM schedule_runs r JOIN schedules s ON s.id = r.schedule_id WHERE r.id = ?`,
      [runId],
    );
  }

  /**
   * M5-F1: if the wake job did start before the crash, the run is linked to it (on time or late);
   * only a run without a job is a failure.
   */
  failStale(before: number): number {
    return this.db.run(
      `UPDATE schedule_runs SET
         job_id = (SELECT j.id FROM wake_jobs j WHERE j.schedule_run_id = schedule_runs.id ORDER BY j.id LIMIT 1),
         status = CASE
           WHEN NOT EXISTS (SELECT 1 FROM wake_jobs j WHERE j.schedule_run_id = schedule_runs.id) THEN 'falhou'
           WHEN claimed_at - planned_at > 120000 THEN 'atrasado'
           ELSE 'executado' END,
         detail = CASE
           WHEN NOT EXISTS (SELECT 1 FROM wake_jobs j WHERE j.schedule_run_id = schedule_runs.id)
             THEN 'interrompido (o serviço reiniciou)'
           WHEN claimed_at - planned_at > 120000
             THEN printf('atrasado (%d min)', (claimed_at - planned_at + 30000) / 60000)
           ELSE NULL END
       WHERE status = 'executando' AND claimed_at <= ?`,
      [before],
    ).changes;
  }

  private getState(key: string): string | null {
    return (
      this.db.get<{ value: string }>('SELECT value FROM system_state WHERE key = ?', [key])
        ?.value ?? null
    );
  }

  private setState(key: string, value: string | null): void {
    if (value === null) this.db.run('DELETE FROM system_state WHERE key = ?', [key]);
    else {
      this.db.run(
        'INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      );
    }
  }

  lastTick(): number | null {
    const v = this.getState(LAST_TICK);
    return v === null ? null : Number(v);
  }

  setLastTick(at: number): void {
    this.setState(LAST_TICK, String(at));
  }

  pause(): PauseState | null {
    const v = this.getState(PAUSE);
    return v === null ? null : (JSON.parse(v) as PauseState);
  }

  setPause(p: PauseState | null): void {
    this.setState(PAUSE, p === null ? null : JSON.stringify(p));
  }
}
