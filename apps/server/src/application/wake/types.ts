import type {
  DeviceResult,
  JobState,
  JobSummary,
  WakeJob,
  WakeJobDevice,
  WakeTarget,
} from '@uniwake/shared';

export type JobSource = 'manual' | 'schedule' | 'test';

export interface NewJobDevice {
  deviceId: number;
  mac: string;
  roomId: number | null;
  result: DeviceResult;
}

export interface NewJob {
  source: JobSource;
  scheduleRunId: number | null;
  requestedBy: number | null;
  target: WakeTarget;
  targetLabel: string;
  onlyOffline: boolean;
  dryRun: boolean;
  stagger: { batchSize: number; batchDelaySeconds: number } | null;
  createdAt: number;
  devices: NewJobDevice[];
  excludedCount: number;
}

export interface PacketLogRow {
  jobId: number;
  deviceId: number;
  mac: string;
  srcIp: string;
  dstIp: string;
  port: number;
  repeat: number;
  at: number;
  outcome: 'sent' | 'error' | 'dry_run';
  error: string | null;
  /** v1.7.0 (FR-701): 0 = first attempt, 1.. = the retry rounds. Absent = 0. */
  round?: number;
  /** v1.7.0 (FR-701.3): the awake lab PC that sent it on the hub's request; absent = this hub. */
  via?: string | null;
}

export interface JobDeviceRow extends WakeJobDevice {
  ip: string | null;
  hostname: string | null;
}

export interface StoredJob extends WakeJob {
  requestedById: number | null;
  target: WakeTarget;
  stagger: { batchSize: number; batchDelaySeconds: number } | null;
  excludedCount: number;
  scheduleRunId: number | null;
}

export interface JobsRepo {
  create(job: NewJob): number;
  get(id: number): StoredJob | undefined;
  devices(jobId: number): JobDeviceRow[];
  setState(
    id: number,
    state: JobState,
    patch?: {
      startedAt?: number;
      finishedAt?: number;
      verifyUntil?: number | null;
      error?: string | null;
    },
  ): void;
  setSummary(id: number, summary: JobSummary): void;
  setDeviceResults(
    jobId: number,
    updates: { deviceId: number; result: DeviceResult; at?: number }[],
  ): void;
  markSent(jobId: number, deviceIds: readonly number[], at: number): void;
  logPackets(rows: readonly PacketLogRow[]): void;
  /** FR-701.3: true when a relayed packet with this job, machine, sender and time is already logged. */
  hasRelayPacket?(jobId: number, deviceId: number, via: string, at: number): boolean;
  packets(jobId: number, limit: number): PacketLogRow[];
  /** Devices still waiting in jobs that are not finished (SR-11). */
  activeDeviceJobs(): Map<number, number>;
  list(limit: number, offset: number): { items: StoredJob[]; total: number };
  unfinished(): StoredJob[];
}

export function summarize(results: readonly DeviceResult[], excluded: number): JobSummary {
  const s: JobSummary = {
    total: results.length,
    woke: 0,
    alreadyOn: 0,
    noResponse: 0,
    sendFailed: 0,
    unverified: 0,
    waiting: 0,
    excluded,
  };
  for (const r of results) {
    if (r === 'acordou') s.woke++;
    else if (r === 'ja_estava_ligado') s.alreadyOn++;
    else if (r === 'nao_respondeu') s.noResponse++;
    else if (r === 'falha_no_envio') s.sendFailed++;
    else if (r === 'nao_verificado') s.unverified++;
    else s.waiting++;
  }
  return s;
}
