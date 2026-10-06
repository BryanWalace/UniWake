import type { DiagnosticsRepo } from '../../application/devices/diagnostics-service';
import type { VerifiedResult } from '../../domain/wake-stats';
import type { Db } from '../connection';

export class SqliteDiagnosticsRepo implements DiagnosticsRepo {
  constructor(private readonly db: Db) {}

  verifiedResults(deviceId: number, limit: number): VerifiedResult[] {
    return this.db.all<VerifiedResult>(
      `SELECT jd.result AS result, COALESCE(jd.woke_at, jd.sent_at, j.created_at) AS at
       FROM wake_job_devices jd JOIN wake_jobs j ON j.id = jd.job_id
       WHERE jd.device_id = ? AND jd.result IN ('acordou', 'nao_respondeu')
       ORDER BY j.created_at DESC, j.id DESC LIMIT ?`,
      [deviceId, limit],
    );
  }

  prepareResults(deviceId: number): Record<string, string> | null {
    const r = this.db.get<{ prepare_results: string | null }>(
      'SELECT prepare_results FROM devices WHERE id = ?',
      [deviceId],
    );
    return r?.prepare_results ? (JSON.parse(r.prepare_results) as Record<string, string>) : null;
  }
}
