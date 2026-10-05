/**
 * Wake actions (FR-003.3, spec §4). The server resolves the target (SR-01), enforces the
 * large-action guard (SR-10) and active-job exclusion (SR-11), rate-limits manual wakes
 * (FR-003.8), records the job + audit atomically and hands it to the runner.
 */
import { type WakePreview, type WakeRequestParams, type WakeTarget } from '@uniwake/shared';
import {
  type DeviceSnap,
  needsConfirmation,
  resolveWake,
  type Resolution,
} from '../../domain/scope';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import type { KeyedLimiter } from '../rate-limit';
import type { RoomsRepo } from '../rooms/rooms-service';
import type { SettingsService } from '../settings/settings-service';
import type { TagsRepo } from '../tags/tags-service';
import type { JobRunner, RunOptions } from './job-runner';
import type { JobSource, JobsRepo, StoredJob } from './types';

export interface WakeServiceDeps {
  snapshot: () => DeviceSnap[];
  rooms: RoomsRepo;
  tags: TagsRepo;
  jobs: JobsRepo;
  settings: SettingsService;
  audit: AuditService;
  clock: Clock;
  runner: JobRunner;
  limiter: KeyedLimiter;
  transaction: <T>(fn: () => T) => T;
  /** Demo mode forces dry-run (constitution §2.5). */
  forceDryRun?: boolean;
}

export interface StartOptions extends RunOptions {
  source?: JobSource;
  scheduleRunId?: number | null;
  /** Schedules were confirmed when saved (SR-10). */
  preConfirmed?: boolean;
}

export interface TargetSummary {
  /** Machines a wake would send to now (disabled ones excluded). */
  count: number;
  /** Nothing to wake at all, not even machines busy in another job ("alvo vazio"). */
  empty: boolean;
  label: string;
  needsConfirmation: boolean;
  rooms: WakePreview['rooms'];
}

export interface StartResult {
  jobId: number;
  count: number;
  excluded: WakePreview['excluded'];
}

export class WakeService {
  constructor(private readonly d: WakeServiceDeps) {}

  private resolve(req: Pick<WakeRequestParams, 'target' | 'onlyOffline'>): Resolution {
    const res = resolveWake(req, this.d.snapshot(), this.d.jobs.activeDeviceJobs());
    if (res.unknownIds.length > 0) {
      throw new AppError(
        'DEVICE_NOT_FOUND',
        { ids: res.unknownIds.join(', ') },
        { unknownIds: res.unknownIds },
      );
    }
    return res;
  }

  private roomsView(res: Resolution): WakePreview['rooms'] {
    const names = new Map(this.d.rooms.list().map((r) => [r.id, r.name]));
    return res.rooms.map((r) => ({
      roomId: r.roomId,
      name: r.roomId === null ? 'Sem sala' : (names.get(r.roomId) ?? `Sala ${r.roomId}`),
      count: r.count,
    }));
  }

  preview(req: WakeRequestParams): WakePreview {
    const res = this.resolve(req);
    return {
      count: res.devices.length,
      rooms: this.roomsView(res),
      excluded: res.excluded,
      needsConfirmation: needsConfirmation(
        req.target,
        res,
        this.d.settings.get('wake.confirmThreshold'),
      ),
    };
  }

  /**
   * Summaries of stored targets (schedules, FR-005.8), resolved against one device snapshot.
   * Unknown ids are not an error here: a deleted room/device just leaves the target smaller.
   */
  describeTargets(targets: readonly WakeTarget[]): TargetSummary[] {
    const snapshot = this.d.snapshot();
    const active = this.d.jobs.activeDeviceJobs();
    const threshold = this.d.settings.get('wake.confirmThreshold');
    return targets.map((target) => {
      const res = resolveWake({ target, onlyOffline: false }, snapshot, active);
      const busy = res.excluded.filter((e) => e.reason === 'in_active_job').length;
      return {
        count: res.devices.length,
        empty: res.devices.length + busy === 0,
        label: this.label(target, res),
        needsConfirmation: needsConfirmation(target, res, threshold),
        rooms: this.roomsView(res),
      };
    });
  }

  /**
   * Audit target (AC-006-06): "room:Lab 3", "rooms:Lab 1, Lab 2", "tag:professor",
   * "device:PC-01", "devices:12", "all". The pt-BR label stays for history.
   */
  auditTarget(target: WakeTarget): string {
    switch (target.type) {
      case 'all':
        return 'all';
      case 'rooms': {
        const names = new Map(this.d.rooms.list().map((r) => [r.id, r.name]));
        const list = target.roomIds.map((id) => names.get(id) ?? `#${id}`);
        if (target.includeNoRoom) list.push('Sem sala');
        return `${list.length === 1 ? 'room' : 'rooms'}:${list.join(', ')}`;
      }
      case 'tags': {
        const names = new Map(this.d.tags.list().map((t) => [t.id, t.name]));
        const list = target.tagIds.map((id) => names.get(id) ?? `#${id}`);
        return `${list.length === 1 ? 'tag' : 'tags'}:${list.join(', ')}`;
      }
      case 'devices': {
        if (target.deviceIds.length !== 1) return `devices:${target.deviceIds.length}`;
        const d = this.d.snapshot().find((x) => x.id === target.deviceIds[0]);
        return `device:${d?.name ?? target.deviceIds[0]}`;
      }
    }
  }

  /** Human label for history and audit, e.g. "sala Lab 3", "etiqueta professor", "todos". */
  label(target: WakeTarget, res: Resolution): string {
    const roomNames = new Map(this.d.rooms.list().map((r) => [r.id, r.name]));
    switch (target.type) {
      case 'all':
        return 'todos';
      case 'rooms': {
        const names = target.roomIds.map((id) => roomNames.get(id) ?? `#${id}`);
        if (target.includeNoRoom) names.push('Sem sala');
        return `${names.length === 1 ? 'sala' : 'salas'} ${names.join(', ')}`;
      }
      case 'tags': {
        const tagNames = new Map(this.d.tags.list().map((t) => [t.id, t.name]));
        const names = target.tagIds.map((id) => tagNames.get(id) ?? `#${id}`);
        return `${names.length === 1 ? 'etiqueta' : 'etiquetas'} ${names.join(', ')}`;
      }
      case 'devices':
        return res.devices.length === 1 && target.deviceIds.length === 1
          ? res.devices[0]!.name
          : `${target.deviceIds.length} dispositivos`;
    }
  }

  start(req: WakeRequestParams, actor: Actor, opts: StartOptions = {}): StartResult {
    const source = opts.source ?? 'manual';
    if (source === 'manual' && actor.id !== null && !this.d.limiter.hit(`wake:${actor.id}`)) {
      throw new AppError('RATE_LIMITED');
    }
    const { jobId, res } = this.d.transaction(() => {
      const res = this.resolve(req);
      if (res.devices.length === 0) {
        const running = [
          ...new Set(res.excluded.filter((e) => e.reason === 'in_active_job').map((e) => e.jobId)),
        ];
        if (running.length > 0) throw new AppError('WAKE_ALREADY_RUNNING', {}, { jobIds: running });
        throw new AppError('WAKE_TARGET_EMPTY', {}, { excluded: res.excluded });
      }
      if (
        !opts.preConfirmed &&
        needsConfirmation(req.target, res, this.d.settings.get('wake.confirmThreshold')) &&
        req.confirm?.count !== res.devices.length
      ) {
        throw new AppError(
          'CONFIRMATION_REQUIRED',
          { count: res.devices.length },
          { count: res.devices.length, rooms: this.roomsView(res) },
        );
      }
      const targetLabel = this.label(req.target, res);
      const dryRun = this.d.forceDryRun === true || this.d.settings.get('wake.dryRun');
      const jobId = this.d.jobs.create({
        source,
        scheduleRunId: opts.scheduleRunId ?? null,
        requestedBy: actor.id,
        target: req.target,
        targetLabel,
        onlyOffline: req.onlyOffline,
        dryRun,
        stagger: req.stagger ?? null,
        createdAt: this.d.clock.now(),
        devices: res.devices.map((d) => ({
          deviceId: d.id,
          mac: d.mac,
          roomId: d.roomId,
          result: d.status === 'online' ? 'ja_estava_ligado' : 'aguardando',
        })),
        excludedCount: res.excluded.length,
      });
      this.d.audit.record({
        actor,
        action: 'wake.start',
        target: this.auditTarget(req.target),
        details: {
          jobId,
          count: res.devices.length,
          excluded: res.excluded.length,
          dryRun,
          source,
        },
      });
      return { jobId, res };
    });
    this.d.runner.start(jobId, opts);
    return { jobId, count: res.devices.length, excluded: res.excluded };
  }

  job(id: number): { job: StoredJob; devices: ReturnType<JobsRepo['devices']> } {
    const job = this.d.jobs.get(id);
    if (!job) throw new AppError('NOT_FOUND');
    return { job, devices: this.d.jobs.devices(id) };
  }

  jobs(limit: number, offset: number) {
    return this.d.jobs.list(Math.min(limit, 200), offset);
  }

  packets(jobId: number, limit = 5000) {
    this.job(jobId);
    return this.d.jobs.packets(jobId, limit);
  }
}
