/**
 * When an update is installed (FR-001.3): "Atualizar agora" by an admin, or by itself in `auto`
 * mode inside the maintenance window. Never while a wake job runs or a schedule is due within 60
 * minutes, unless an admin overrides (AC-001-11). Hands the verified plan to the updater through
 * scheduled tasks (ADR-023), and at the next start records what the updater reported.
 */
import { join } from 'node:path';
import type { UpdateStatus } from '@uniwake/shared';
import { insideWindow, localDay } from '../../domain/tz';
import { type Actor, type AuditService, SYSTEM_ACTOR } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock, FileSystem, Logger, TimerHandle } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import { PLAN_FILE, type UpdateInstaller } from './update-installer';
import type { UpdateService } from './update-service';

/** Registers the watchdog and updater tasks for a plan and starts the updater (ADR-023). */
export interface UpdateLauncher {
  launch(planFile: string): Promise<void>;
}

/** What updater.mjs wrote (see updater/updater.ts UpdateOutcome). */
interface Outcome {
  result: 'success' | 'rolled_back' | 'failed';
  version: string;
  reason?: string;
  at: number;
}

export interface UpdateCoordinatorDeps {
  update: UpdateService;
  installer: UpdateInstaller | null;
  launcher: UpdateLauncher | null;
  fs: FileSystem | null;
  settings: SettingsService;
  audit: AuditService;
  clock: Clock;
  logger: Logger;
  notice: (type: 'update_failed' | 'update_done', data: Record<string, unknown>) => void;
  activeJobs: () => number;
  nextScheduledRunAt: () => number | null;
}

const GUARD_MS = 60 * 60_000;
const TICK_MS = 5 * 60_000;

const REASON_TEXT: Record<string, string> = {
  INSTALLER_FAILED: 'o instalador falhou',
  HEALTH_TIMEOUT: 'a nova versão não respondeu em 2 minutos',
  WRONG_VERSION: 'a versão iniciada não era a esperada',
  INTERRUPTED: 'a atualização foi interrompida',
  STOP_TIMEOUT: 'o serviço não parou a tempo',
};

/** pt-BR line for the dashboard about an update outcome (FR-001.3, AC-001-08, AC-001-13). */
export function outcomeMessage(o: Outcome): string {
  if (o.result === 'success') return `UniWake atualizado para a versão ${o.version}.`;
  if (o.reason === 'INTERRUPTED') return 'Atualização interrompida — versão anterior restaurada.';
  if (o.result === 'failed') {
    return `Atualização não instalada: ${REASON_TEXT[o.reason ?? ''] ?? o.reason}. A versão ${o.version} continua em uso.`;
  }
  return `Atualização revertida: ${REASON_TEXT[o.reason ?? ''] ?? o.reason}. A versão ${o.version} foi restaurada.`;
}

export class UpdateCoordinator {
  private timer: TimerHandle | null = null;
  private installing: string | null = null;
  /** Local day of the last automatic attempt: one try per window, even if it failed. */
  private lastAutoDay: string | null = null;

  constructor(private readonly d: UpdateCoordinatorDeps) {}

  get canInstall(): boolean {
    return this.d.installer !== null && this.d.launcher !== null;
  }

  /** The version being handed to the updater right now, if any. */
  get installingVersion(): string | null {
    return this.installing;
  }

  status(): UpdateStatus {
    return {
      ...this.d.update.status(),
      canInstall: this.canInstall,
      installing: this.installing,
      blocked: this.blocked(),
    };
  }

  /** AC-001-11: busy now, or a schedule due within the next hour. */
  blocked(): boolean {
    const next = this.d.nextScheduledRunAt();
    return this.d.activeJobs() > 0 || (next !== null && next - this.d.clock.now() <= GUARD_MS);
  }

  async installNow(actor: Actor, override = false): Promise<{ version: string }> {
    const { installer, launcher } = this.d;
    const pending = this.d.update.pending();
    if (!installer || !launcher || !pending) throw new AppError('UPDATE_NOT_AVAILABLE');
    if (this.installing) throw new AppError('UPDATE_IN_PROGRESS');
    if (this.blocked() && !override) throw new AppError('UPDATE_BLOCKED_BY_SCHEDULE');
    this.installing = pending.version;
    try {
      await installer.prepare(actor);
      this.d.audit.record({
        actor,
        action: 'update.start',
        target: `version:${pending.version}`,
        details: { override, blocked: this.blocked() },
      });
      await launcher.launch(join(installer.updatesDir, PLAN_FILE));
      return { version: pending.version };
    } catch (e) {
      this.installing = null;
      throw e;
    }
  }

  start(): void {
    if (!this.canInstall) return;
    const tick = () => {
      this.timer = this.d.clock.setTimeout(() => {
        void this.tick().finally(tick);
      }, TICK_MS);
    };
    tick();
  }

  stop(): void {
    if (this.timer) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Automatic mode: inside the window, nothing busy, once per day (AC-001-11). */
  async tick(): Promise<void> {
    const s = this.d.settings;
    if (s.get('update.mode') !== 'auto' || !this.d.update.pending() || this.installing) return;
    const now = this.d.clock.now();
    const tz = s.get('scheduler.timezone');
    if (!insideWindow(now, tz, s.get('update.windowStart'), s.get('update.windowEnd'))) return;
    if (this.blocked()) {
      this.d.logger.info({}, 'automatic update postponed: wake running or schedule due');
      return;
    }
    const day = localDay(now, tz);
    if (this.lastAutoDay === day) return;
    this.lastAutoDay = day;
    try {
      await this.installNow(SYSTEM_ACTOR);
    } catch (e) {
      this.d.logger.warn({ err: e }, 'automatic update did not start');
    }
  }

  /** At start-up: record the updater's outcome once (audit + dashboard), then forget it. */
  async recordOutcome(updatesDir: string): Promise<Outcome | null> {
    const fs = this.d.fs;
    if (!fs) return null;
    const file = join(updatesDir, 'update-result.json');
    if (!(await fs.exists(file))) return null;
    let outcome: Outcome;
    try {
      outcome = JSON.parse(await fs.readText(file)) as Outcome;
    } catch (e) {
      this.d.logger.warn({ err: e }, 'unreadable update result');
      await fs.remove(file);
      return null;
    }
    const message = outcomeMessage(outcome);
    this.d.audit.record({
      actor: SYSTEM_ACTOR,
      action: outcome.result === 'success' ? 'update.success' : 'update.failed',
      target: `version:${outcome.version}`,
      result: outcome.result === 'success' ? 'ok' : 'error',
      details: { result: outcome.result, reason: outcome.reason ?? null, at: outcome.at },
    });
    this.d.notice(outcome.result === 'success' ? 'update_done' : 'update_failed', { message });
    await fs.remove(file);
    return outcome;
  }
}
