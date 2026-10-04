/**
 * Runs wake jobs (FR-003.2–.6, plan §7.1): read interfaces at send time, stagger, send magic
 * packets on every route/port with repeats, log every attempt, then verify within the window.
 * Jobs survive restarts: `recover()` resumes verification or closes them (AC-003-17).
 */
import type { DeviceResult, JobState, Settings } from '@uniwake/shared';
import { magicPacket } from '../../domain/magic-packet';
import { type NetInterface, routesFor, selectInterfaces } from '../../domain/network';
import { planStagger } from '../../domain/stagger';
import type { AuditService } from '../audit/audit-service';
import type { EventsBus } from '../events-bus';
import type { Clock, Logger, NetworkInterfaces, PacketSender } from '../ports';
import type { RoomsRepo } from '../rooms/rooms-service';
import type { SettingsService } from '../settings/settings-service';
import {
  type JobDeviceRow,
  type JobsRepo,
  type PacketLogRow,
  type StoredJob,
  summarize,
} from './types';
import { hasAddress, type Verifier } from './verifier';

export const NETWORK_RETRY_MS = 30_000;

export interface JobRunnerDeps {
  jobs: JobsRepo;
  rooms: RoomsRepo;
  settings: SettingsService;
  clock: Clock;
  interfaces: NetworkInterfaces;
  sender: PacketSender;
  dryRunSender: PacketSender;
  verifier: Verifier;
  audit: AuditService;
  events: EventsBus;
  logger: Logger;
  transaction: <T>(fn: () => T) => T;
  /** Called when a job reaches a final state (scheduler morning result, M5). */
  onFinished?: (job: StoredJob) => void;
}

export interface RunOptions {
  /** Scheduled jobs keep retrying while no interface is usable, until this time (AC-003-16). */
  networkRetryUntil?: number;
}

const FINAL: readonly JobState[] = ['concluido', 'interrompido', 'falhou'];

export class JobRunner {
  private readonly running = new Map<number, Promise<void>>();

  constructor(private readonly d: JobRunnerDeps) {}

  start(jobId: number, opts: RunOptions = {}): void {
    this.track(jobId, () => this.run(jobId, opts));
  }

  /** Resolves when no job is running (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()]);
  }

  get activeCount(): number {
    return this.running.size;
  }

  /** On hub start: resume verification still in its window, close everything else (AC-003-17). */
  recover(): void {
    const now = this.d.clock.now();
    for (const job of this.d.jobs.unfinished()) {
      if (job.state === 'verificando' && job.verifyUntil !== null && job.verifyUntil > now) {
        this.d.logger.info({ jobId: job.id }, 'resuming wake verification after restart');
        this.track(job.id, () => this.verify(job.id, job.verifyUntil!));
      } else {
        this.close(job.id, 'interrompido', 'Serviço reiniciado durante a ligação.');
      }
    }
  }

  private track(jobId: number, fn: () => Promise<void>) {
    const p = fn()
      .catch((e: unknown) => {
        this.d.logger.error({ jobId, err: e }, 'wake job failed');
        this.close(jobId, 'falhou', e instanceof Error ? e.message : String(e));
      })
      .finally(() => this.running.delete(jobId));
    this.running.set(jobId, p);
  }

  private publish(jobId: number) {
    const job = this.d.jobs.get(jobId);
    if (job)
      this.d.events.publish({
        type: 'job.progress',
        jobId,
        state: job.state,
        summary: job.summary,
      });
  }

  private refreshSummary(jobId: number) {
    const job = this.d.jobs.get(jobId);
    if (!job) return;
    const results = this.d.jobs.devices(jobId).map((x) => x.result);
    this.d.jobs.setSummary(jobId, summarize(results, job.excludedCount));
  }

  private setResults(
    jobId: number,
    updates: { deviceId: number; result: DeviceResult; at?: number }[],
  ) {
    if (updates.length === 0) return;
    this.d.transaction(() => {
      this.d.jobs.setDeviceResults(jobId, updates);
      this.refreshSummary(jobId);
    });
    for (const u of updates) {
      this.d.events.publish({ type: 'job.device', jobId, deviceId: u.deviceId, result: u.result });
    }
  }

  private async usableInterfaces(
    s: Settings,
    opts: RunOptions,
    jobId: number,
  ): Promise<NetInterface[]> {
    for (;;) {
      const all = await this.d.interfaces.list().catch(() => []);
      const selected = selectInterfaces(all, s['wake.interfaces']);
      if (selected.length > 0) return selected;
      const until = opts.networkRetryUntil;
      if (until === undefined || this.d.clock.now() + NETWORK_RETRY_MS > until) return [];
      this.d.logger.warn({ jobId }, 'no usable network interface yet; retrying in 30 s');
      await this.d.clock.sleep(NETWORK_RETRY_MS);
    }
  }

  private async run(jobId: number, opts: RunOptions): Promise<void> {
    const { jobs, clock } = this.d;
    const job = jobs.get(jobId);
    if (!job || FINAL.includes(job.state)) return;
    const s = this.d.settings.all();
    jobs.setState(jobId, 'enviando', { startedAt: clock.now() });
    this.publish(jobId);

    const ifaces = await this.usableInterfaces(s, opts, jobId);
    const devices = jobs.devices(jobId);
    if (ifaces.length === 0) {
      this.setResults(
        jobId,
        devices
          .filter((x) => x.result === 'aguardando')
          .map((x) => ({ deviceId: x.deviceId, result: 'falha_no_envio' as const })),
      );
      this.close(jobId, 'falhou', 'NO_NETWORK_INTERFACE');
      return;
    }

    await this.send(job, devices, ifaces, s);
    await this.verify(jobId, clock.now() + s['wake.verifyWindowMinutes'] * 60_000);
  }

  private async send(job: StoredJob, devices: JobDeviceRow[], ifaces: NetInterface[], s: Settings) {
    const { jobs, clock } = this.d;
    const rooms = new Map(this.d.rooms.list().map((r) => [r.id, r]));
    const sender = job.dryRun ? this.d.dryRunSender : this.d.sender;
    const settingsFor = (roomId: number | null) => {
      if (job.stagger)
        return { batchSize: job.stagger.batchSize, delayMs: job.stagger.batchDelaySeconds * 1000 };
      const room = roomId === null ? undefined : rooms.get(roomId);
      return {
        batchSize: room?.batchSize ?? s['wake.batchSize'],
        delayMs: (room?.batchDelaySeconds ?? s['wake.batchDelaySeconds']) * 1000,
      };
    };
    const steps = planStagger(
      devices.map((x) => ({ deviceId: x.deviceId, roomId: x.roomId })),
      settingsFor,
      s['wake.maxDevicesPerStep'],
      s['wake.batchDelaySeconds'] * 1000,
    );
    const byId = new Map(devices.map((x) => [x.deviceId, x]));
    const t0 = clock.now();
    for (const step of steps) {
      const wait = t0 + step.atMs - clock.now();
      if (wait > 0) await clock.sleep(wait);
      const ok = new Set<number>();
      for (let repeat = 0; repeat < s['wake.repeat']; repeat++) {
        const rows: PacketLogRow[] = [];
        for (const deviceId of step.deviceIds) {
          const dev = byId.get(deviceId)!;
          const room = dev.roomId === null ? undefined : rooms.get(dev.roomId);
          const payload = magicPacket(dev.mac);
          for (const route of routesFor(ifaces, room?.directedBroadcast ?? null)) {
            for (const port of s['wake.ports']) {
              const at = clock.now();
              try {
                await sender.send({
                  sourceIp: route.sourceIp,
                  destination: route.destination,
                  port,
                  payload,
                });
                ok.add(deviceId);
                rows.push({
                  jobId: job.id,
                  deviceId,
                  mac: dev.mac,
                  srcIp: route.sourceIp,
                  dstIp: route.destination,
                  port,
                  repeat,
                  at,
                  outcome: job.dryRun ? 'dry_run' : 'sent',
                  error: null,
                });
              } catch (e) {
                const err = e as NodeJS.ErrnoException;
                rows.push({
                  jobId: job.id,
                  deviceId,
                  mac: dev.mac,
                  srcIp: route.sourceIp,
                  dstIp: route.destination,
                  port,
                  repeat,
                  at,
                  outcome: 'error',
                  error: (err.code ?? err.message ?? 'erro').slice(0, 200),
                });
              }
            }
          }
        }
        this.d.transaction(() => jobs.logPackets(rows));
        if (repeat < s['wake.repeat'] - 1) await clock.sleep(s['wake.repeatIntervalMs']);
      }
      const now = clock.now();
      this.d.transaction(() => jobs.markSent(job.id, [...ok], now));
      this.setResults(
        job.id,
        step.deviceIds
          .filter((id) => !ok.has(id) && byId.get(id)!.result === 'aguardando')
          .map((id) => ({ deviceId: id, result: 'falha_no_envio' as const })),
      );
      this.publish(job.id);
    }
  }

  private async verify(jobId: number, verifyUntil: number): Promise<void> {
    const { jobs, clock } = this.d;
    jobs.setState(jobId, 'verificando', { verifyUntil });
    this.publish(jobId);
    const waiting = () => jobs.devices(jobId).filter((x) => x.result === 'aguardando');

    this.setResults(
      jobId,
      waiting()
        .filter((x) => !hasAddress(x))
        .map((x) => ({ deviceId: x.deviceId, result: 'nao_verificado' as const })),
    );

    const interval = this.d.settings.get('wake.verifyIntervalSeconds') * 1000;
    while (waiting().length > 0 && clock.now() < verifyUntil) {
      await clock.sleep(Math.min(interval, verifyUntil - clock.now()));
      const pending = waiting();
      const alive = await this.d.verifier.check(pending).catch(() => new Set<number>());
      const now = clock.now();
      this.setResults(
        jobId,
        pending
          .filter((x) => alive.has(x.deviceId))
          .map((x) => ({ deviceId: x.deviceId, result: 'acordou' as const, at: now })),
      );
      this.publish(jobId);
    }
    this.setResults(
      jobId,
      waiting().map((x) => ({ deviceId: x.deviceId, result: 'nao_respondeu' as const })),
    );
    this.close(jobId, 'concluido', null);
  }

  /** Final state + audit in one transaction (M2-F2); leftover waiting devices are resolved. */
  private close(jobId: number, state: JobState, error: string | null) {
    const job = this.d.jobs.get(jobId);
    if (!job || FINAL.includes(job.state)) return;
    const now = this.d.clock.now();
    this.d.transaction(() => {
      const leftovers = this.d.jobs
        .devices(jobId)
        .filter((x) => x.result === 'aguardando')
        .map((x): { deviceId: number; result: DeviceResult } => ({
          deviceId: x.deviceId,
          result: x.sentAt === null ? 'falha_no_envio' : 'nao_respondeu',
        }));
      this.d.jobs.setDeviceResults(jobId, leftovers);
      this.refreshSummary(jobId);
      this.d.jobs.setState(jobId, state, { finishedAt: now, error });
      const final = this.d.jobs.get(jobId)!;
      this.d.audit.record({
        actor: {
          id: null,
          label: job.source === 'schedule' ? 'agendamento' : (job.requestedBy ?? 'sistema'),
        },
        action: 'wake.finish',
        target: job.targetLabel,
        result: state === 'concluido' ? 'ok' : 'error',
        details: { jobId, state, error, ...final.summary },
      });
    });
    this.publish(jobId);
    const final = this.d.jobs.get(jobId);
    if (final) this.d.onFinished?.(final);
  }
}
