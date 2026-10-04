/**
 * Retention and cleanup (spec §9, plan §5.1): nightly, in chunks of 5 000 rows so the synchronous
 * database never blocks the event loop for long, and never while a wake job runs (its packet log
 * and results are being written). A start-up run catches up when the hub was off at night.
 */
import { localDay, nextLocalTime } from '../../domain/tz';
import type { Clock, Logger, TimerHandle } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export const RETENTION_CHUNK = 5_000;
const RUN_AT = '01:30';
const DAY = 86_400_000;
const RETRY_WHILE_BUSY_MS = 10 * 60_000;
const STARTUP_DELAY_MS = 10 * 60_000;
/** Acknowledged notices and spent enrollment tokens are kept this long for reference. */
const SHORT_KEEP_DAYS = 30;

/** One cleanup rule: deletes at most `limit` rows and returns how many it deleted. */
export type PurgeRule =
  | { table: 'packet_log'; before: number }
  | { table: 'device_events'; before: number }
  | { table: 'daily_uptime'; beforeDay: string }
  | { table: 'wake_jobs'; before: number }
  | { table: 'schedule_runs'; before: number }
  | { table: 'audit_log'; before: number }
  | { table: 'sessions'; now: number; idleBefore: number }
  | { table: 'enrollment_tokens'; before: number }
  | { table: 'notices'; ackBefore: number; before: number };

export interface RetentionRepo {
  purge(rule: PurgeRule, limit: number): number;
  lastRun(): number | null;
  setLastRun(at: number): void;
}

export interface RetentionDeps {
  repo: RetentionRepo;
  settings: SettingsService;
  clock: Clock;
  logger: Logger;
  /** True while any wake job is sending or verifying. */
  busy: () => boolean;
  /** Lets other work run between chunks (setImmediate in the hub). */
  yieldNow: () => Promise<void>;
}

export type RetentionReport = Partial<Record<PurgeRule['table'], number>>;

export class RetentionService {
  private timer: TimerHandle | null = null;
  private running: Promise<RetentionReport | null> | null = null;

  constructor(private readonly d: RetentionDeps) {}

  rules(now: number): PurgeRule[] {
    const s = this.d.settings;
    const history = now - s.get('retention.historyDays') * DAY;
    const short = now - SHORT_KEEP_DAYS * DAY;
    return [
      { table: 'packet_log', before: now - s.get('retention.packetLogDays') * DAY },
      { table: 'device_events', before: history },
      { table: 'daily_uptime', beforeDay: localDay(history, s.get('scheduler.timezone')) },
      { table: 'schedule_runs', before: history },
      { table: 'wake_jobs', before: history },
      { table: 'audit_log', before: now - s.get('retention.auditDays') * DAY },
      {
        table: 'sessions',
        now,
        idleBefore: now - s.get('security.sessionIdleHours') * 3_600_000,
      },
      { table: 'enrollment_tokens', before: short },
      { table: 'notices', ackBefore: short, before: history },
    ];
  }

  /** Runs every rule to completion; null when postponed because a wake job is running. */
  run(): Promise<RetentionReport | null> {
    this.running ??= this.runOnce().finally(() => (this.running = null));
    return this.running;
  }

  private async runOnce(): Promise<RetentionReport | null> {
    const report: RetentionReport = {};
    const now = this.d.clock.now();
    for (const rule of this.rules(now)) {
      for (;;) {
        if (this.d.busy()) {
          this.d.logger.info({ ...report }, 'retention postponed: a wake job is running');
          return null;
        }
        const n = this.d.repo.purge(rule, RETENTION_CHUNK);
        if (n > 0) report[rule.table] = (report[rule.table] ?? 0) + n;
        if (n < RETENTION_CHUNK) break;
        await this.d.yieldNow();
      }
    }
    this.d.repo.setLastRun(now);
    if (Object.keys(report).length > 0) this.d.logger.info({ ...report }, 'retention cleanup done');
    return report;
  }

  /** Nightly at 01:30 local; soon after start when the last run is over a day old. */
  start(): void {
    const now = this.d.clock.now();
    const last = this.d.repo.lastRun();
    const nightly = nextLocalTime(now, RUN_AT, this.d.settings.get('scheduler.timezone'));
    const due = last === null || now - last > DAY ? now + STARTUP_DELAY_MS : nightly;
    this.schedule(Math.min(due, nightly) - now);
  }

  /** Stops scheduling and waits for a run in progress, so the database can close safely. */
  async stop(): Promise<void> {
    this.clearTimer();
    await this.running?.catch(() => undefined);
  }

  private clearTimer() {
    if (this.timer !== null) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number) {
    this.clearTimer();
    this.timer = this.d.clock.setTimeout(() => {
      this.timer = null;
      void this.run()
        .then((r) => {
          const now = this.d.clock.now();
          const tz = this.d.settings.get('scheduler.timezone');
          this.schedule(r === null ? RETRY_WHILE_BUSY_MS : nextLocalTime(now, RUN_AT, tz) - now);
        })
        .catch((e: unknown) => {
          this.d.logger.error({ err: e }, 'retention cleanup failed');
          this.schedule(RETRY_WHILE_BUSY_MS * 6);
        });
    }, delayMs);
  }
}
