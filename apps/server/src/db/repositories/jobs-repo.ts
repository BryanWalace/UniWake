import type { DeviceResult, JobState, JobSummary, WakeTarget } from '@uniwake/shared';
import {
  type JobDeviceRow,
  type JobsRepo,
  type NewJob,
  type PacketLogRow,
  type StoredJob,
  summarize,
} from '../../application/wake/types';
import type { Db } from '../connection';

interface JobRow {
  id: number;
  source: StoredJob['source'];
  schedule_run_id: number | null;
  requested_by: number | null;
  requested_by_name: string | null;
  target: string;
  only_offline: number;
  dry_run: number;
  state: JobState;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  verify_until: number | null;
  summary: string;
}

interface TargetJson {
  descriptor: WakeTarget;
  label: string;
  stagger: StoredJob['stagger'];
}
interface SummaryJson extends Partial<JobSummary> {
  error?: string | null;
  excluded?: number;
}

const ACTIVE_STATES = "('pendente', 'enviando', 'verificando')";

const SELECT_JOB = `SELECT j.*, u.username AS requested_by_name FROM wake_jobs j
  LEFT JOIN users u ON u.id = j.requested_by`;

export class SqliteJobsRepo implements JobsRepo {
  constructor(private readonly db: Db) {}

  private toJob(r: JobRow): StoredJob {
    const target = JSON.parse(r.target) as TargetJson;
    const summary = JSON.parse(r.summary) as SummaryJson;
    const excluded = summary.excluded ?? 0;
    return {
      id: r.id,
      source: r.source,
      scheduleRunId: r.schedule_run_id,
      requestedBy: r.requested_by_name ?? (r.source === 'schedule' ? 'agendamento' : null),
      requestedById: r.requested_by,
      target: target.descriptor,
      targetLabel: target.label,
      stagger: target.stagger,
      onlyOffline: r.only_offline === 1,
      dryRun: r.dry_run === 1,
      state: r.state,
      error: summary.error ?? null,
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      verifyUntil: r.verify_until,
      excludedCount: excluded,
      summary: {
        total: summary.total ?? 0,
        woke: summary.woke ?? 0,
        alreadyOn: summary.alreadyOn ?? 0,
        noResponse: summary.noResponse ?? 0,
        sendFailed: summary.sendFailed ?? 0,
        unverified: summary.unverified ?? 0,
        waiting: summary.waiting ?? 0,
        excluded,
      },
    };
  }

  create(job: NewJob): number {
    const target: TargetJson = {
      descriptor: job.target,
      label: job.targetLabel,
      stagger: job.stagger,
    };
    const summary: SummaryJson = {
      ...summarize(
        job.devices.map((d) => d.result),
        job.excludedCount,
      ),
      error: null,
    };
    const id = this.db.run(
      `INSERT INTO wake_jobs (source, schedule_run_id, requested_by, target, only_offline, dry_run,
         state, created_at, summary) VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?)`,
      [
        job.source,
        job.scheduleRunId,
        job.requestedBy,
        JSON.stringify(target),
        job.onlyOffline ? 1 : 0,
        job.dryRun ? 1 : 0,
        job.createdAt,
        JSON.stringify(summary),
      ],
    ).lastInsertRowid;
    for (const d of job.devices) {
      this.db.run(
        `INSERT INTO wake_job_devices (job_id, device_id, mac, room_id, result) VALUES (?, ?, ?, ?, ?)`,
        [id, d.deviceId, d.mac, d.roomId, d.result],
      );
    }
    return id;
  }

  get(id: number): StoredJob | undefined {
    const r = this.db.get<JobRow>(`${SELECT_JOB} WHERE j.id = ?`, [id]);
    return r ? this.toJob(r) : undefined;
  }

  devices(jobId: number): JobDeviceRow[] {
    return this.db
      .all<{
        device_id: number;
        name: string | null;
        mac: string;
        room_id: number | null;
        result: DeviceResult;
        sent_at: number | null;
        woke_at: number | null;
        ip: string | null;
        hostname: string | null;
      }>(
        `SELECT jd.device_id, d.name, jd.mac, jd.room_id, jd.result, jd.sent_at, jd.woke_at, d.ip, d.hostname
         FROM wake_job_devices jd LEFT JOIN devices d ON d.id = jd.device_id
         WHERE jd.job_id = ? ORDER BY d.name COLLATE NOCASE, jd.device_id`,
        [jobId],
      )
      .map((r) => ({
        deviceId: r.device_id,
        name: r.name ?? r.mac,
        mac: r.mac,
        roomId: r.room_id,
        result: r.result,
        sentAt: r.sent_at,
        wokeAt: r.woke_at,
        ip: r.ip,
        hostname: r.hostname,
      }));
  }

  setState(
    id: number,
    state: JobState,
    patch: {
      startedAt?: number;
      finishedAt?: number;
      verifyUntil?: number | null;
      error?: string | null;
    } = {},
  ): void {
    const sets = ['state = ?'];
    const params: (string | number | null)[] = [state];
    if (patch.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(patch.startedAt);
    }
    if (patch.finishedAt !== undefined) {
      sets.push('finished_at = ?');
      params.push(patch.finishedAt);
    }
    if (patch.verifyUntil !== undefined) {
      sets.push('verify_until = ?');
      params.push(patch.verifyUntil);
    }
    if (patch.error !== undefined) {
      sets.push("summary = json_set(summary, '$.error', ?)");
      params.push(patch.error);
    }
    this.db.run(`UPDATE wake_jobs SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  setSummary(id: number, summary: JobSummary): void {
    const cur = JSON.parse(
      this.db.get<{ summary: string }>('SELECT summary FROM wake_jobs WHERE id = ?', [id])
        ?.summary ?? '{}',
    ) as SummaryJson;
    this.db.run('UPDATE wake_jobs SET summary = ? WHERE id = ?', [
      JSON.stringify({ ...cur, ...summary }),
      id,
    ]);
  }

  setDeviceResults(
    jobId: number,
    updates: { deviceId: number; result: DeviceResult; at?: number }[],
  ): void {
    for (const u of updates) {
      this.db.run(
        `UPDATE wake_job_devices SET result = ?, woke_at = CASE WHEN ? = 'acordou' THEN ? ELSE woke_at END
         WHERE job_id = ? AND device_id = ?`,
        [u.result, u.result, u.at ?? null, jobId, u.deviceId],
      );
    }
  }

  markSent(jobId: number, deviceIds: readonly number[], at: number): void {
    for (const id of deviceIds) {
      this.db.run(
        'UPDATE wake_job_devices SET sent_at = COALESCE(sent_at, ?) WHERE job_id = ? AND device_id = ?',
        [at, jobId, id],
      );
    }
  }

  logPackets(rows: readonly PacketLogRow[]): void {
    for (const r of rows) {
      this.db.run(
        `INSERT INTO packet_log (job_id, device_id, mac, src_ip, dst_ip, port, repeat, at, outcome, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.jobId, r.deviceId, r.mac, r.srcIp, r.dstIp, r.port, r.repeat, r.at, r.outcome, r.error],
      );
    }
  }

  packets(jobId: number, limit: number): PacketLogRow[] {
    return this.db
      .all<{
        job_id: number;
        device_id: number;
        mac: string;
        src_ip: string;
        dst_ip: string;
        port: number;
        repeat: number;
        at: number;
        outcome: PacketLogRow['outcome'];
        error: string | null;
      }>('SELECT * FROM packet_log WHERE job_id = ? ORDER BY id LIMIT ?', [jobId, limit])
      .map((r) => ({
        jobId: r.job_id,
        deviceId: r.device_id,
        mac: r.mac,
        srcIp: r.src_ip,
        dstIp: r.dst_ip,
        port: r.port,
        repeat: r.repeat,
        at: r.at,
        outcome: r.outcome,
        error: r.error,
      }));
  }

  activeDeviceJobs(): Map<number, number> {
    const rows = this.db.all<{ device_id: number; job_id: number }>(
      `SELECT jd.device_id, jd.job_id FROM wake_job_devices jd JOIN wake_jobs j ON j.id = jd.job_id
       WHERE j.state IN ${ACTIVE_STATES} AND jd.result = 'aguardando'`,
    );
    return new Map(rows.map((r) => [r.device_id, r.job_id]));
  }

  list(limit: number, offset: number): { items: StoredJob[]; total: number } {
    const total = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM wake_jobs')?.n ?? 0;
    const items = this.db
      .all<JobRow>(`${SELECT_JOB} ORDER BY j.created_at DESC, j.id DESC LIMIT ? OFFSET ?`, [
        limit,
        offset,
      ])
      .map((r) => this.toJob(r));
    return { items, total };
  }

  unfinished(): StoredJob[] {
    return this.db
      .all<JobRow>(`${SELECT_JOB} WHERE j.state IN ${ACTIVE_STATES} ORDER BY j.id`)
      .map((r) => this.toJob(r));
  }
}
