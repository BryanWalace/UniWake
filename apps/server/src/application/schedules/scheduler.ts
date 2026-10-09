/**
 * Scheduler (FR-005.3–.7, ADR-008). Ticks every 15 s and looks at every occurrence planned since
 * the previous tick (persisted, so downtime is seen on the next start). Each occurrence is first
 * claimed with an INSERT on the unique (schedule, planned time) key, then executed: two schedulers,
 * a restart or a clock jumped back can never fire the same run twice (AC-005-03/04).
 */
import {
  type SchedulerPause,
  type SchedulerPauseInput,
  schedulerPauseSchema,
  type WakeRequestParams,
} from '@uniwake/shared';
import {
  decideRuns,
  exceptionFor,
  occurrencesBetween,
  ON_TIME_MS,
  type RunStatus,
} from '../../domain/schedule';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { EventsBus } from '../events-bus';
import type { Clock, Logger, TimerHandle } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import type { StartOptions, StartResult } from '../wake/wake-service';
import { rule, type ScheduleRecord, rowsToTarget, type TargetRefs } from './schedules-service';

export const TICK_MS = 15_000;
/** Downtime longer than this is not replayed run by run (one week of "perdido" rows at most). */
export const MAX_LOOKBACK_MS = 7 * 86_400_000;

export type StoredRunStatus = RunStatus | 'executando';

export interface PauseState {
  since: number;
  reason: string;
  /** Automatic resume (UTC ms), or null for a manual resume. */
  resumeAt: number | null;
  /** Who paused (username), for the banner. */
  by: string | null;
}

export interface SchedulerRepo {
  enabledSchedules(): ScheduleRecord[];
  exceptions(): {
    scheduleId: number | null;
    startDate: string;
    endDate: string;
    description: string;
  }[];
  /** Inserts the run unless that (schedule, planned time) exists; returns its id or null. */
  claim(
    scheduleId: number,
    plannedAt: number,
    claimedAt: number,
    status: StoredRunStatus,
    detail: string | null,
  ): number | null;
  finish(runId: number, status: StoredRunStatus, detail: string | null, jobId: number | null): void;
  /** Marks claims left "executando" (claimed at or before `before`) as failed; returns how many. */
  failStale(before: number): number;
  /** The schedule behind a run (morning result). */
  runInfo(
    runId: number,
  ): { scheduleId: number; scheduleName: string; plannedAt: number } | undefined;
  lastTick(): number | null;
  setLastTick(at: number): void;
  /** A record for this occurrence exists (here, or synced from another PC). */
  runExists(scheduleId: number, plannedAt: number): boolean;
  pause(): PauseState | null;
  setPause(p: PauseState | null): void;
}

/**
 * ADR-034: decides whether this installation handles (executes or logs) a due occurrence. With
 * several installations online, v1.2's lease elects one; it keeps its own state current in the
 * background so this question is answered synchronously inside the tick.
 */
export interface ExecutionLease {
  shouldHandle(o: {
    scheduleId: number;
    scheduleUuid: string | null;
    plannedAt: number;
    now: number;
  }): boolean;
}

/** A single installation always handles its runs (v1.0). */
export const SOLO_LEASE: ExecutionLease = { shouldHandle: () => true };

export interface SchedulerDeps {
  repo: SchedulerRepo;
  /** Defaults to {@link SOLO_LEASE}. */
  lease?: ExecutionLease;
  /** FR-204.2: in team mode, runs missed while this PC was off are offered, not replayed. */
  teamMode?: () => boolean;
  onMissedRun?: (r: { scheduleId: number; scheduleName: string; plannedAt: number }) => void;
  refs: TargetRefs;
  startWake: (req: WakeRequestParams, actor: Actor, opts: StartOptions) => StartResult;
  settings: SettingsService;
  audit: AuditService;
  clock: Clock;
  events: EventsBus;
  logger: Logger;
  transaction: <T>(fn: () => T) => T;
  /** A run that woke nothing (failed or lost): the morning result shows it (FR-013). */
  onRunProblem?: (r: {
    scheduleId: number;
    scheduleName: string;
    plannedAt: number;
    status: 'falhou' | 'perdido';
    detail: string | null;
  }) => void;
}

export interface TickReport {
  ran: number;
  logged: number;
}

/** Why a scheduled wake could not start, in the operator's words (FR-005.7/.8). */
function failureDetail(e: unknown): string {
  if (e instanceof AppError) {
    switch (e.code) {
      case 'WAKE_TARGET_EMPTY':
        return 'alvo vazio';
      case 'WAKE_ALREADY_RUNNING':
        return 'as máquinas já estavam sendo ligadas';
      case 'DEVICE_NOT_FOUND':
        return 'máquina removida do cadastro';
      default:
        return e.code;
    }
  }
  return 'erro inesperado';
}

/** FR-204.2: missed runs become notices after the first sync round. */
export const MISSED_RUN_DELAY_MS = 60_000;

export class Scheduler {
  private timer: TimerHandle | null = null;
  private ticking = false;
  private stopped = true;
  /** When this process started handling schedules (missed vs. live occurrences, FR-204.2). */
  private readonly startedAt: number;
  /** Occurrences another PC was elected for (ADR-039): asked again each tick. */
  private readonly deferred = new Map<string, { s: ScheduleRecord; at: number }>();
  private missed: { s: ScheduleRecord; at: number }[] = [];

  constructor(private readonly d: SchedulerDeps) {
    this.startedAt = d.clock.now();
  }

  /** One evaluation of everything due since the last tick. */
  tick(): TickReport {
    if (this.ticking) return { ran: 0, logged: 0 };
    this.ticking = true;
    try {
      return this.tickOnce();
    } finally {
      this.ticking = false;
    }
  }

  private tickOnce(): TickReport {
    const now = this.d.clock.now();
    const graceMs = this.d.settings.get('scheduler.graceMinutes') * 60_000;
    const last = this.d.repo.lastTick();
    const pause = this.autoResume(now);
    // First start ever: only the grace window counts. A clock jumped back keeps the old mark,
    // so the window it already covered is not evaluated again.
    const from = Math.max(last ?? now - graceMs, now - MAX_LOOKBACK_MS);
    const report: TickReport = { ran: 0, logged: 0 };
    if (now > from) {
      const exceptions = this.d.repo.exceptions();
      for (const s of this.d.repo.enabledSchedules()) {
        const due = occurrencesBetween(rule(s), Math.max(from, s.createdAt), now);
        if (due.length === 0) continue;
        const decisions = decideRuns(due, now, {
          graceMs,
          exception: (day) => exceptionFor(day, exceptions, s.id),
          pausedAt: (at) =>
            pause !== null && at >= pause.since && (pause.resumeAt === null || at < pause.resumeAt),
        });
        const lease = this.d.lease ?? SOLO_LEASE;
        const team = this.d.teamMode?.() ?? false;
        for (const decision of decisions) {
          const at = decision.occurrence.at;
          if (team && at < this.startedAt) {
            // Planned while this PC was off: another PC may have run it (FR-204.2).
            if (decision.action === 'run') this.missed.push({ s, at });
            continue;
          }
          const handle = lease.shouldHandle({
            scheduleId: s.id,
            scheduleUuid: s.uuid ?? null,
            plannedAt: at,
            now,
          });
          // Another installation was elected; ask again next tick (ADR-039).
          if (!handle) {
            if (decision.action === 'run') this.deferred.set(`${s.id}@${at}`, { s, at });
            continue;
          }
          if (decision.action === 'log') {
            const id = this.d.repo.claim(
              s.id,
              decision.occurrence.at,
              now,
              decision.status,
              decision.detail,
            );
            if (id !== null) {
              report.logged++;
              if (decision.status === 'perdido')
                this.problem(s, decision.occurrence.at, 'perdido', null);
            }
          } else if (
            this.execute(s, decision.occurrence.at, decision.status, decision.delayMs, graceMs, now)
          ) {
            report.ran++;
          }
        }
      }
    }
    report.ran += this.retryDeferred(now, graceMs);
    this.flushMissed(now, graceMs);
    this.d.repo.setLastTick(Math.max(now, last ?? now));
    return report;
  }

  /**
   * ADR-039: a deferred occurrence is dropped once its record arrived (the elected PC ran it) or its
   * grace window passed; it runs here when the lease now says so (fallback).
   */
  private retryDeferred(now: number, graceMs: number): number {
    let ran = 0;
    const lease = this.d.lease ?? SOLO_LEASE;
    for (const [key, { s, at }] of this.deferred) {
      if (now - at > graceMs || this.d.repo.runExists(s.id, at)) {
        this.deferred.delete(key);
        continue;
      }
      if (
        !lease.shouldHandle({ scheduleId: s.id, scheduleUuid: s.uuid ?? null, plannedAt: at, now })
      ) {
        continue;
      }
      this.deferred.delete(key);
      const delayMs = now - at;
      if (
        this.execute(s, at, delayMs <= ON_TIME_MS ? 'executado' : 'atrasado', delayMs, graceMs, now)
      ) {
        ran++;
      }
    }
    return ran;
  }

  /** FR-204.2: after the first sync round, missed runs nobody recorded become "Ligar agora". */
  private flushMissed(now: number, graceMs: number): void {
    if (this.missed.length === 0 || now < this.startedAt + MISSED_RUN_DELAY_MS) return;
    const missed = this.missed;
    this.missed = [];
    for (const { s, at } of missed) {
      if (this.startedAt - at > graceMs || this.d.repo.runExists(s.id, at)) continue;
      this.d.onMissedRun?.({ scheduleId: s.id, scheduleName: s.name, plannedAt: at });
    }
  }

  private execute(
    s: ScheduleRecord,
    plannedAt: number,
    status: 'executado' | 'atrasado',
    delayMs: number,
    graceMs: number,
    now: number,
  ): boolean {
    const detail = status === 'atrasado' ? `atrasado (${Math.round(delayMs / 60_000)} min)` : null;
    // Claim first, in its own transaction: whoever inserts the row runs it (ADR-008).
    const runId = this.d.repo.claim(s.id, plannedAt, now, 'executando', null);
    if (runId === null) return false;
    try {
      const { jobId } = this.d.startWake(
        {
          target: rowsToTarget(s.targets, this.d.refs),
          onlyOffline: s.onlyOffline,
          ...(s.batchSize !== null && s.batchDelayMs !== null
            ? {
                stagger: {
                  batchSize: s.batchSize,
                  batchDelaySeconds: Math.round(s.batchDelayMs / 1000),
                },
              }
            : {}),
        },
        // The scheduler acts, not the person who once saved the schedule: history shows "agendamento".
        { id: null, label: `agendamento ${s.name}` },
        {
          source: 'schedule',
          scheduleRunId: runId,
          preConfirmed: true, // confirmed when the schedule was saved (SR-10)
          networkRetryUntil: plannedAt + graceMs,
        },
      );
      this.d.repo.finish(runId, status, detail, jobId);
      this.d.logger.info({ scheduleId: s.id, runId, jobId, status }, 'scheduled wake started');
    } catch (e) {
      // M5-F2: someone is already waking these machines (e.g. by hand at 06:49): that job is
      // this run's result, not a failure for the morning card.
      const running =
        e instanceof AppError && e.code === 'WAKE_ALREADY_RUNNING'
          ? (e.details as { jobIds?: number[] } | undefined)?.jobIds?.[0]
          : undefined;
      if (running !== undefined) {
        this.d.repo.finish(runId, status, `já em andamento (ligação #${running})`, running);
        return true;
      }
      const reason = failureDetail(e);
      this.d.repo.finish(runId, 'falhou', reason, null);
      this.d.logger.warn({ scheduleId: s.id, runId, reason }, 'scheduled wake failed');
      this.problem(s, plannedAt, 'falhou', reason);
    }
    return true;
  }

  private problem(
    s: ScheduleRecord,
    plannedAt: number,
    status: 'falhou' | 'perdido',
    detail: string | null,
  ) {
    try {
      this.d.onRunProblem?.({ scheduleId: s.id, scheduleName: s.name, plannedAt, status, detail });
    } catch (e) {
      this.d.logger.error({ err: e }, 'could not record the morning result');
    }
  }

  /** Clears a pause whose automatic resume time has come (FR-005.6). */
  private autoResume(now: number): PauseState | null {
    const pause = this.d.repo.pause();
    if (pause && pause.resumeAt !== null && pause.resumeAt <= now) {
      // Runs planned before the resume time still count as paused in this tick.
      this.d.repo.setPause(null);
      this.d.events.publish({ type: 'scheduler', paused: false });
      this.d.logger.info({}, 'scheduler resumed automatically');
    }
    return pause;
  }

  // ---------------------------------------------------------------- pause (FR-005.6)

  pauseState(): SchedulerPause | null {
    const p = this.d.repo.pause();
    // An expired automatic resume reads as running even before the next tick clears it.
    if (!p || (p.resumeAt !== null && p.resumeAt <= this.d.clock.now())) return null;
    return { since: p.since, reason: p.reason, resumeAt: p.resumeAt, by: p.by };
  }

  pause(input: SchedulerPauseInput, actor: Actor): SchedulerPause {
    const data = schedulerPauseSchema.parse(input);
    const reason = data.reason?.trim().normalize('NFC') ?? '';
    if (reason === '') throw new AppError('PAUSE_REASON_REQUIRED');
    const now = this.d.clock.now();
    const resumeAt = data.resumeAt ?? null;
    if (resumeAt !== null && resumeAt <= now) {
      throw new AppError('VALIDATION_FAILED', {}, [
        { path: 'resumeAt', message: 'A retomada automática precisa ser no futuro.' },
      ]);
    }
    const state: PauseState = { since: now, reason, resumeAt, by: actor.label };
    this.d.transaction(() => {
      this.d.repo.setPause(state);
      this.d.audit.record({
        actor,
        action: 'scheduler.pause',
        target: 'scheduler',
        details: { reason, resumeAt },
      });
    });
    this.d.events.publish({ type: 'scheduler', paused: true });
    return this.pauseState()!;
  }

  resume(actor: Actor): void {
    const was = this.d.repo.pause();
    if (!was) return;
    this.d.transaction(() => {
      this.d.repo.setPause(null);
      this.d.audit.record({
        actor,
        action: 'scheduler.resume',
        target: 'scheduler',
        details: { since: was.since },
      });
    });
    this.d.events.publish({ type: 'scheduler', paused: false });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // Claim, wake start and result happen in one synchronous step of a tick: a claim still
    // "executando" at start-up was interrupted by a crash or restart.
    const n = this.d.repo.failStale(this.d.clock.now());
    if (n > 0)
      this.d.logger.warn({ runs: n }, 'scheduled runs interrupted by a restart marked as failed');
    this.loop(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private loop(delayMs: number) {
    if (this.stopped) return;
    this.timer = this.d.clock.setTimeout(() => {
      try {
        this.tick();
      } catch (e) {
        // DB busy and the like: the mark did not move, so the next tick retries the same window.
        this.d.logger.error({ err: e }, 'scheduler tick failed');
      }
      this.loop(TICK_MS);
    }, delayMs);
  }
}

export type { RunStatus };
