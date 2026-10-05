/**
 * Notices (FR-013): "Resultado da manhã" collects, per local day, the scheduled runs that need
 * attention (machines that did not wake, failed or lost runs). Pinned on the dashboard until
 * someone acknowledges it ("Ciente"); the acknowledgement is audited.
 */
import type { DashboardNotice, MorningResult, MorningRun } from '@uniwake/shared';
import { localDay } from '../../domain/tz';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { EventsBus } from '../events-bus';
import type { Clock } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import type { JobDeviceRow, StoredJob } from '../wake/types';

export interface NoticesRepo {
  open(limit: number): DashboardNotice[];
  get(id: number): (DashboardNotice & { acknowledgedAt: number | null }) | undefined;
  insert(type: string, data: object, at: number): number;
  updateData(id: number, data: object): void;
  acknowledge(id: number, by: number | null, at: number): boolean;
  /** The open morning-result notice of that local day, if any. */
  openMorningResult(day: string): { id: number; data: MorningResult } | undefined;
}

export interface NoticesDeps {
  repo: NoticesRepo;
  /** Run and schedule behind a scheduled job. */
  runOf: (
    runId: number,
  ) => { scheduleId: number; scheduleName: string; plannedAt: number } | undefined;
  jobDevices: (jobId: number) => JobDeviceRow[];
  roomName: (roomId: number) => string | undefined;
  settings: SettingsService;
  audit: AuditService;
  clock: Clock;
  events: EventsBus;
  transaction: <T>(fn: () => T) => T;
}

const NOT_WOKEN = new Set(['nao_respondeu', 'falha_no_envio']);

export class NoticesService {
  constructor(private readonly d: NoticesDeps) {}

  list(): DashboardNotice[] {
    return this.d.repo.open(50);
  }

  acknowledge(id: number, actor: Actor): void {
    this.d.transaction(() => {
      const n = this.d.repo.get(id);
      if (!n) throw new AppError('NOT_FOUND');
      if (n.acknowledgedAt !== null) return; // already done by someone else
      this.d.repo.acknowledge(id, actor.id, this.d.clock.now());
      this.d.audit.record({
        actor,
        action: 'notice.ack',
        target: `notice:${n.type}`,
        details: {
          id,
          ...(n.type === 'morning_result' ? { day: (n.data as unknown as MorningResult).day } : {}),
        },
      });
    });
    this.d.events.publish({ type: 'notice', id, noticeType: 'ack' });
  }

  /** A scheduled wake reached its final state (JobRunner onFinished). */
  onJobFinished(job: StoredJob): void {
    if (job.source !== 'schedule' || job.scheduleRunId === null) return;
    const run = this.d.runOf(job.scheduleRunId);
    if (!run) return;
    const devices = this.d.jobDevices(job.id);
    const failed = devices.filter((x) => NOT_WOKEN.has(x.result));
    if (failed.length === 0) return; // everything woke: nothing to pin
    const byRoom = new Map<number | null, MorningRun['notWoken'][number]>();
    for (const x of failed) {
      let room = byRoom.get(x.roomId);
      if (!room) {
        room = {
          roomId: x.roomId,
          roomName:
            x.roomId === null ? 'Sem sala' : (this.d.roomName(x.roomId) ?? `Sala ${x.roomId}`),
          devices: [],
        };
        byRoom.set(x.roomId, room);
      }
      room.devices.push({ id: x.deviceId, name: x.name, result: x.result });
    }
    this.addRun({
      ...run,
      status:
        run.plannedAt + 2 * 60_000 < (job.startedAt ?? job.createdAt) ? 'atrasado' : 'executado',
      detail: null,
      jobId: job.id,
      total: job.summary.total,
      woke: job.summary.woke + job.summary.alreadyOn,
      notWoken: [...byRoom.values()],
    });
  }

  /** A scheduled run that woke nothing: failed (e.g. "alvo vazio") or lost. */
  onRunProblem(r: {
    scheduleId: number;
    scheduleName: string;
    plannedAt: number;
    status: 'falhou' | 'perdido';
    detail: string | null;
  }): void {
    // M5-F3: after a long outage (vacation) the log keeps every lost run, but only the last
    // day's are news worth pinning.
    if (r.status === 'perdido' && this.d.clock.now() - r.plannedAt > 86_400_000) return;
    this.addRun({ ...r, jobId: null, total: 0, woke: 0, notWoken: [] });
  }

  private addRun(run: MorningRun): void {
    const day = localDay(run.plannedAt, this.d.settings.get('scheduler.timezone'));
    const id = this.d.transaction(() => {
      const open = this.d.repo.openMorningResult(day);
      if (open) {
        const runs = [
          ...open.data.runs.filter(
            (r) => !(r.scheduleId === run.scheduleId && r.plannedAt === run.plannedAt),
          ),
          run,
        ];
        runs.sort((a, b) => a.plannedAt - b.plannedAt);
        this.d.repo.updateData(open.id, { day, runs });
        return open.id;
      }
      return this.d.repo.insert(
        'morning_result',
        { day, runs: [run] } satisfies MorningResult,
        this.d.clock.now(),
      );
    });
    this.d.events.publish({ type: 'notice', id, noticeType: 'morning_result' });
  }
}
