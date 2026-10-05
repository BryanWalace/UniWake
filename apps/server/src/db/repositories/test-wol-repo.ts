import { TEST_WOL_ACTIVE_STATES, type TestWolRun, type TestWolState } from '@uniwake/shared';
import type { TestWolRepo } from '../../application/test-wol/test-wol-service';
import type { Db } from '../connection';

interface Row {
  id: number;
  device_id: number;
  device_name: string;
  state: TestWolState;
  requested_by_name: string | null;
  started_at: number;
  offline_at: number | null;
  sent_at: number | null;
  finished_at: number | null;
  job_id: number | null;
  detail: string | null;
}

const SELECT = `SELECT t.*, d.name AS device_name, u.username AS requested_by_name
  FROM test_wol_runs t
  JOIN devices d ON d.id = t.device_id
  LEFT JOIN users u ON u.id = t.requested_by`;
const ACTIVE = `(${TEST_WOL_ACTIVE_STATES.map((s) => `'${s}'`).join(', ')})`;

const toRun = (r: Row): TestWolRun => ({
  id: r.id,
  deviceId: r.device_id,
  deviceName: r.device_name,
  state: r.state,
  requestedBy: r.requested_by_name,
  startedAt: r.started_at,
  offlineAt: r.offline_at,
  sentAt: r.sent_at,
  finishedAt: r.finished_at,
  jobId: r.job_id,
  detail: r.detail,
});

const COLUMNS: Record<string, string> = {
  state: 'state',
  offlineAt: 'offline_at',
  sentAt: 'sent_at',
  finishedAt: 'finished_at',
  jobId: 'job_id',
  detail: 'detail',
};

export class SqliteTestWolRepo implements TestWolRepo {
  constructor(private readonly db: Db) {}

  insert(r: { deviceId: number; requestedBy: number | null; startedAt: number }): number {
    return this.db.run(
      `INSERT INTO test_wol_runs (device_id, state, requested_by, started_at)
       VALUES (?, 'aguardando_desligar', ?, ?)`,
      [r.deviceId, r.requestedBy, r.startedAt],
    ).lastInsertRowid;
  }

  get(id: number): TestWolRun | undefined {
    const r = this.db.get<Row>(`${SELECT} WHERE t.id = ?`, [id]);
    return r ? toRun(r) : undefined;
  }

  activeForDevice(deviceId: number): TestWolRun | undefined {
    const r = this.db.get<Row>(
      `${SELECT} WHERE t.device_id = ? AND t.state IN ${ACTIVE} ORDER BY t.id DESC LIMIT 1`,
      [deviceId],
    );
    return r ? toRun(r) : undefined;
  }

  active(): TestWolRun[] {
    return this.db.all<Row>(`${SELECT} WHERE t.state IN ${ACTIVE} ORDER BY t.id`).map(toRun);
  }

  byJob(jobId: number): TestWolRun | undefined {
    const r = this.db.get<Row>(`${SELECT} WHERE t.job_id = ?`, [jobId]);
    return r ? toRun(r) : undefined;
  }

  latestForDevice(deviceId: number): TestWolRun | undefined {
    const r = this.db.get<Row>(`${SELECT} WHERE t.device_id = ? ORDER BY t.id DESC LIMIT 1`, [
      deviceId,
    ]);
    return r ? toRun(r) : undefined;
  }

  update(id: number, patch: Partial<Record<keyof typeof COLUMNS, unknown>>): void {
    const keys = Object.keys(patch).filter((k) => k in COLUMNS);
    if (keys.length === 0) return;
    this.db.run(
      `UPDATE test_wol_runs SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => patch[k] as string | number | null), id],
    );
  }
}
