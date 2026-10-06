/**
 * "Testar WoL desta máquina" (FR-007.4, AC-007-10). The technician turns the computer off; the
 * flow probes it every 5 s until two probes in a row get no answer, waits 30 s more so the network
 * card can arm itself for wake, then sends through the normal wake engine (a one-device job with
 * source "test") and records whether the computer came back within the verification window.
 * Runs are stored so diagnostics can show the last result; a restart ends unfinished runs.
 */
import {
  type DeviceResult,
  TEST_WOL_ACTIVE_STATES,
  type TestWolRun,
  type TestWolState,
} from '@uniwake/shared';
import { type Actor, type AuditService, SYSTEM_ACTOR } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock, Logger, TimerHandle } from '../ports';
import type { StoredJob } from '../wake/types';
import type { Verifier } from '../wake/verifier';

export interface TestWolRepo {
  insert(r: { deviceId: number; requestedBy: number | null; startedAt: number }): number;
  get(id: number): TestWolRun | undefined;
  activeForDevice(deviceId: number): TestWolRun | undefined;
  active(): TestWolRun[];
  byJob(jobId: number): TestWolRun | undefined;
  latestForDevice(deviceId: number): TestWolRun | undefined;
  update(
    id: number,
    patch: Partial<
      Pick<TestWolRun, 'state' | 'offlineAt' | 'sentAt' | 'finishedAt' | 'jobId' | 'detail'>
    >,
  ): void;
}

export interface TestWolDeps {
  repo: TestWolRepo;
  device: (
    id: number,
  ) =>
    | { id: number; name: string; ip: string | null; hostname: string | null; enabled: boolean }
    | undefined;
  verifier: Verifier;
  /** Starts a one-device wake job (source "test"); returns its id. */
  startWake: (deviceId: number, actor: Actor) => number;
  jobResult: (jobId: number, deviceId: number) => DeviceResult | undefined;
  audit: AuditService;
  clock: Clock;
  logger: Logger;
}

/** Probe interval while waiting for the computer to turn off. */
export const TEST_WOL_POLL_MS = 5_000;
/** Missed probes in a row that mean "off". */
const OFFLINE_MISSES = 2;
/** NIC arming time after shutdown before sending (FR-007.4). */
export const TEST_WOL_ARMING_MS = 30_000;
/** Give up when the computer is still on after this long. */
export const TEST_WOL_WAIT_OFF_MS = 10 * 60_000;

const RESULT: Partial<Record<DeviceResult, { state: TestWolState; detail: string | null }>> = {
  acordou: { state: 'sucesso', detail: null },
  nao_respondeu: {
    state: 'nao_acordou',
    detail: 'O computador não respondeu dentro do tempo de verificação.',
  },
  ja_estava_ligado: {
    state: 'falhou',
    detail: 'O computador já estava ligado quando o Magic Packet foi enviado.',
  },
  falha_no_envio: { state: 'falhou', detail: 'Não foi possível enviar o Magic Packet.' },
  nao_verificado: {
    state: 'falhou',
    detail: 'O Magic Packet foi enviado, mas não há IP ou nome para verificar se ligou.',
  },
};

const isActive = (r: TestWolRun | undefined): r is TestWolRun =>
  r !== undefined && TEST_WOL_ACTIVE_STATES.includes(r.state);

export class TestWolService {
  private readonly timers = new Map<number, TimerHandle>();
  private readonly misses = new Map<number, number>();
  private readonly actors = new Map<number, Actor>();
  private stopped = false;

  constructor(private readonly d: TestWolDeps) {}

  get(id: number): TestWolRun {
    const r = this.d.repo.get(id);
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  latestForDevice(deviceId: number): TestWolRun | null {
    return this.d.repo.latestForDevice(deviceId) ?? null;
  }

  /** Starts a test, or returns the one already running for this computer. */
  start(deviceId: number, actor: Actor): TestWolRun {
    const device = this.d.device(deviceId);
    if (!device) throw new AppError('NOT_FOUND');
    const running = this.d.repo.activeForDevice(deviceId);
    if (running) return running;
    if (!device.enabled) {
      throw new AppError('VALIDATION_FAILED', {}, [
        { path: 'enabled', message: 'Ative o computador no UniWake antes de testar.' },
      ]);
    }
    if (device.ip === null && device.hostname === null) {
      throw new AppError('VALIDATION_FAILED', {}, [
        {
          path: 'ip',
          message: 'Cadastre o IP ou o nome do computador para saber quando ele desliga e liga.',
        },
      ]);
    }
    const id = this.d.repo.insert({
      deviceId,
      requestedBy: actor.id,
      startedAt: this.d.clock.now(),
    });
    this.d.audit.record({
      actor,
      action: 'test_wol.start',
      target: `device:${device.name}`,
      details: { runId: id },
    });
    this.actors.set(id, actor);
    this.schedule(id, 0);
    return this.get(id);
  }

  cancel(id: number, actor: Actor): TestWolRun {
    const run = this.get(id);
    if (!isActive(run)) return run;
    this.finish(id, 'cancelado', null);
    this.d.audit.record({
      actor,
      action: 'test_wol.cancel',
      target: `device:${run.deviceName}`,
      details: { runId: id },
    });
    return this.get(id);
  }

  /** JobRunner onFinished: the test's job reached its final state. */
  onJobFinished(job: StoredJob): void {
    if (job.source !== 'test') return;
    const run = this.d.repo.byJob(job.id);
    if (!run || run.state !== 'aguardando_ligar') return;
    const result = this.d.jobResult(job.id, run.deviceId);
    const outcome = (result && RESULT[result]) ?? {
      state: 'falhou' as const,
      detail: 'A ligação terminou sem resultado para este computador.',
    };
    this.finish(run.id, outcome.state, outcome.detail);
  }

  /** At start-up: runs cut by a restart cannot continue (their timers are gone). */
  recover(): void {
    for (const run of this.d.repo.active()) {
      this.finish(run.id, 'cancelado', 'Interrompido: o UniWake foi reiniciado.');
    }
  }

  stop(): void {
    // M7-F2: a step still waiting for its probe must not arm a new timer after shutdown.
    this.stopped = true;
    for (const t of this.timers.values()) this.d.clock.clearTimeout(t);
    this.timers.clear();
  }

  private schedule(id: number, ms: number): void {
    if (this.stopped) return;
    this.timers.set(
      id,
      this.d.clock.setTimeout(() => {
        this.timers.delete(id);
        this.step(id).catch((e: unknown) => {
          this.d.logger.error({ err: e, runId: id }, 'test-wol step failed');
          this.finish(id, 'falhou', 'Erro interno durante o teste.');
        });
      }, ms),
    );
  }

  private finish(id: number, state: TestWolState, detail: string | null): void {
    const timer = this.timers.get(id);
    if (timer) this.d.clock.clearTimeout(timer);
    this.timers.delete(id);
    this.misses.delete(id);
    this.actors.delete(id);
    if (!isActive(this.d.repo.get(id))) return;
    this.d.repo.update(id, { state, detail, finishedAt: this.d.clock.now() });
    if (state !== 'cancelado') {
      const run = this.get(id);
      this.d.audit.record({
        actor: SYSTEM_ACTOR,
        action: 'test_wol.finish',
        target: `device:${run.deviceName}`,
        result: state === 'sucesso' ? 'ok' : 'error',
        details: { runId: id, state, jobId: run.jobId },
      });
    }
  }

  private async step(id: number): Promise<void> {
    const run = this.d.repo.get(id);
    if (!isActive(run)) return;
    const now = this.d.clock.now();
    const device = this.d.device(run.deviceId);
    if (!device) {
      this.finish(id, 'cancelado', 'O computador foi excluído.');
      return;
    }
    if (run.state === 'aguardando_desligar') {
      if (now - run.startedAt >= TEST_WOL_WAIT_OFF_MS) {
        this.finish(
          id,
          'falhou',
          'O computador não desligou em 10 minutos. Desligue-o pelo menu Iniciar e teste de novo.',
        );
        return;
      }
      const alive = await this.d.verifier.check([
        { deviceId: device.id, ip: device.ip, hostname: device.hostname },
      ]);
      if (this.d.repo.get(id)?.state !== 'aguardando_desligar') return; // cancelled meanwhile
      const misses = alive.has(device.id) ? 0 : (this.misses.get(id) ?? 0) + 1;
      this.misses.set(id, misses);
      if (misses < OFFLINE_MISSES) {
        this.schedule(id, TEST_WOL_POLL_MS);
        return;
      }
      const offlineAt = this.d.clock.now();
      this.d.repo.update(id, { state: 'aguardando_placa', offlineAt });
      this.schedule(id, TEST_WOL_ARMING_MS);
      return;
    }
    if (run.state === 'aguardando_placa') {
      try {
        const jobId = this.d.startWake(device.id, this.actors.get(id) ?? SYSTEM_ACTOR);
        this.d.repo.update(id, { state: 'aguardando_ligar', sentAt: this.d.clock.now(), jobId });
      } catch (e) {
        this.finish(id, 'falhou', e instanceof Error ? e.message : String(e));
      }
    }
  }
}
