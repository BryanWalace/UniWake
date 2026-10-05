/**
 * Health (FR-012, IMP-008/013/022): what can silently stop the morning wake — a stalled scheduler
 * or monitor, a wrong clock, a controller that sleeps on AC power, a pending Windows reboot,
 * Windows Update active hours that leave the morning open. Slow checks (processes, network) run in
 * the background and are cached; the public status only says ok / degraded / down.
 */
import type { Clock, Logger, TimerHandle } from '../ports';

export type HealthStatus = 'ok' | 'degraded' | 'down';

/** Windows host facts; null = unknown (not Windows, or the check failed). */
export interface HostFacts {
  sleepOnAc: boolean | null;
  pendingReboot: boolean | null;
  /** Windows Update active hours (0–23), or null when unknown. */
  activeHours: { start: number; end: number } | null;
}

export interface HostChecks {
  check(): Promise<HostFacts>;
}

export interface TimeCheck {
  /** A trusted "now" (e.g. the GitHub Date header); null when unreachable. */
  remoteNow(): Promise<number | null>;
}

export interface HealthWarning {
  code:
    | 'scheduler_stalled'
    | 'monitor_stalled'
    | 'sweep_slow'
    | 'clock_skew'
    | 'sleep_on_ac'
    | 'pending_reboot'
    | 'active_hours'
    | 'database';
  severity: 'error' | 'warning';
  message: string;
}

export interface HealthDetails {
  status: HealthStatus;
  version: string;
  startedAt: number;
  uptimeMs: number;
  dbSizeBytes: number | null;
  lastBackupAt: number | null;
  scheduler: {
    lastTickAt: number | null;
    stalled: boolean;
    paused: boolean;
    nextRun: { scheduleName: string; at: number } | null;
  };
  monitor: { lastSweepAt: number | null; durationMs: number | null; stalled: boolean };
  clock: { skewMs: number | null; checkedAt: number | null };
  host: HostFacts & { checkedAt: number | null };
  warnings: HealthWarning[];
}

export interface HealthDeps {
  clock: Clock;
  logger: Logger;
  version: string;
  startedAt: number;
  dbOk: () => boolean;
  dbSizeBytes: () => number | null;
  lastBackupAt: () => number | null;
  schedulerLastTick: () => number | null;
  schedulerPaused: () => boolean;
  nextRun: () => { scheduleName: string; at: number } | null;
  lastSweep: () => { startedAt: number; durationMs: number } | null;
  monitorIntervalMs: () => number;
  host: HostChecks | null;
  time: TimeCheck | null;
}

const MIN = 60_000;
export const STALL_MS = 2 * MIN;
export const SKEW_WARN_MS = 2 * MIN;
const SLOW_CHECK_EVERY_MS = 6 * 60 * MIN;

/** Active hours cover 05:00–08:00 (the morning wake window), also when they wrap midnight. */
export function coversMorning(h: { start: number; end: number }): boolean {
  const inside = (hour: number) =>
    h.start <= h.end ? hour >= h.start && hour < h.end : hour >= h.start || hour < h.end;
  return [5, 6, 7].every(inside);
}

export class HealthService {
  private skew: { skewMs: number | null; checkedAt: number | null } = {
    skewMs: null,
    checkedAt: null,
  };
  private host: HostFacts & { checkedAt: number | null } = {
    sleepOnAc: null,
    pendingReboot: null,
    activeHours: null,
    checkedAt: null,
  };
  private timer: TimerHandle | null = null;

  constructor(private readonly d: HealthDeps) {}

  /** Runs the slow checks now (start-up, every 6 h, and on demand). */
  async refreshSlowChecks(): Promise<void> {
    const now = () => this.d.clock.now();
    if (this.d.time) {
      try {
        const before = now();
        const remote = await this.d.time.remoteNow();
        const local = before + (now() - before) / 2; // the middle of the round trip
        this.skew = {
          skewMs: remote === null ? null : Math.round(remote - local),
          checkedAt: now(),
        };
      } catch (e) {
        this.d.logger.warn({ err: e }, 'clock check failed');
      }
    }
    if (this.d.host) {
      try {
        this.host = { ...(await this.d.host.check()), checkedAt: now() };
      } catch (e) {
        this.d.logger.warn({ err: e }, 'Windows host checks failed');
      }
    }
  }

  start(): void {
    if (this.timer !== null) return;
    void this.refreshSlowChecks();
    const loop = () => {
      this.timer = this.d.clock.setTimeout(() => {
        void this.refreshSlowChecks().finally(loop);
      }, SLOW_CHECK_EVERY_MS);
    };
    loop();
  }

  stop(): void {
    if (this.timer !== null) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedulerStalled(now: number): boolean {
    const last = this.d.schedulerLastTick();
    // Right after start nothing has ticked yet; after 2 minutes that is a stall too.
    if (last === null) return now - this.d.startedAt > STALL_MS;
    return now - last > STALL_MS;
  }

  private monitorStalled(now: number): boolean {
    const last = this.d.lastSweep();
    const limit = Math.max(3 * this.d.monitorIntervalMs(), 5 * MIN);
    return last === null ? now - this.d.startedAt > limit : now - last.startedAt > limit;
  }

  /** Public status (AC-012-02): nothing but this word leaves without a session. */
  status(): HealthStatus {
    if (!this.d.dbOk()) return 'down';
    const now = this.d.clock.now();
    return this.schedulerStalled(now) || this.monitorStalled(now) ? 'degraded' : 'ok';
  }

  details(): HealthDetails {
    const now = this.d.clock.now();
    const dbOk = this.d.dbOk();
    const schedulerStalled = this.schedulerStalled(now);
    const monitorStalled = this.monitorStalled(now);
    const sweep = this.d.lastSweep();
    const warnings: HealthWarning[] = [];
    if (!dbOk) {
      warnings.push({
        code: 'database',
        severity: 'error',
        message:
          'O banco de dados não responde. Reinicie o serviço UniWake; se continuar, restaure um backup.',
      });
    }
    if (schedulerStalled) {
      warnings.push({
        code: 'scheduler_stalled',
        severity: 'error',
        message:
          'Agendador parado: nenhuma verificação nos últimos 2 minutos. Reinicie o serviço UniWake e veja os logs.',
      });
    }
    if (monitorStalled) {
      warnings.push({
        code: 'monitor_stalled',
        severity: 'error',
        message:
          'O monitoramento de status parou. Os status no painel podem estar desatualizados; reinicie o serviço.',
      });
    }
    if (sweep && sweep.durationMs > 30_000) {
      warnings.push({
        code: 'sweep_slow',
        severity: 'warning',
        message: `A última verificação de status levou ${Math.round(sweep.durationMs / 1000)} s (meta: 30 s). Aumente a concorrência ou o intervalo em Configurações › Monitoramento.`,
      });
    }
    if (this.skew.skewMs !== null && Math.abs(this.skew.skewMs) > SKEW_WARN_MS) {
      const min = Math.round(Math.abs(this.skew.skewMs) / MIN);
      warnings.push({
        code: 'clock_skew',
        severity: 'warning',
        message: `O relógio deste computador está ${min} min ${this.skew.skewMs > 0 ? 'atrasado' : 'adiantado'}. Os agendamentos usam este relógio: ajuste a hora do Windows (Configurações › Hora e idioma › Sincronizar agora).`,
      });
    }
    if (this.host.sleepOnAc === true) {
      warnings.push({
        code: 'sleep_on_ac',
        severity: 'warning',
        message:
          'Este computador pode suspender ligado na tomada; se dormir à noite, os agendamentos da manhã não rodam. Em Opções de Energia, defina "Suspender" como "Nunca" na tomada.',
      });
    }
    if (this.host.pendingReboot === true) {
      warnings.push({
        code: 'pending_reboot',
        severity: 'warning',
        message:
          'O Windows está esperando para reiniciar. Reinicie fora do horário dos agendamentos para não perder a ligação da manhã.',
      });
    }
    if (this.host.activeHours && !coversMorning(this.host.activeHours)) {
      warnings.push({
        code: 'active_hours',
        severity: 'warning',
        message: `O "horário ativo" do Windows Update (${this.host.activeHours.start}h–${this.host.activeHours.end}h) não cobre 05:00–08:00: o Windows pode reiniciar durante a ligação da manhã. Ajuste em Windows Update › Opções avançadas.`,
      });
    }
    return {
      status: !dbOk ? 'down' : schedulerStalled || monitorStalled ? 'degraded' : 'ok',
      version: this.d.version,
      startedAt: this.d.startedAt,
      uptimeMs: now - this.d.startedAt,
      dbSizeBytes: this.d.dbSizeBytes(),
      lastBackupAt: this.d.lastBackupAt(),
      scheduler: {
        lastTickAt: this.d.schedulerLastTick(),
        stalled: schedulerStalled,
        paused: this.d.schedulerPaused(),
        nextRun: this.d.nextRun(),
      },
      monitor: {
        lastSweepAt: sweep?.startedAt ?? null,
        durationMs: sweep?.durationMs ?? null,
        stalled: monitorStalled,
      },
      clock: this.skew,
      host: this.host,
      warnings,
    };
  }
}
