/**
 * "Testar agendamento" (FR-504.3, ADR-056): a one-off scheduled shutdown of one machine in N
 * minutes, delivered like a schedule occurrence through both paths — an agenda item at the
 * machine's next check-in (pull) and the hub's order at T − aviso − 1 min (push), both carrying the
 * test's UUID as the run id, so the machine runs it once — and reconciled at T + 10 min with the
 * same categories. Machine-local: the test belongs to the hub the machine talks to.
 */
import type {
  AgendaItem,
  PowerPolicy,
  ShutdownResult,
  ShutdownTest,
  WakeTarget,
} from '@uniwake/shared';
import { AGENDA_LOOKBACK_MS } from '../../domain/agenda';
import type { AgentReadiness } from '../../domain/readiness';
import { AppError } from '../errors';
import type { Actor, AuditService } from '../audit/audit-service';
import type { Clock, Logger } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import type { AgendaService } from './agenda-service';
import type { PowerOrdersService } from './power-orders';
import type { OccurrenceScope, PowerStatusService, TestOccurrence } from './power-status';
import { RECONCILE_AFTER_MS } from './reconcile';

const MIN = 60_000;
const DAY = 86_400_000;
/** Late-wake rule (ADR-045): nothing is pushed after T + 60 min. */
const LATE_MS = 60 * MIN;

export interface ShutdownTestRow {
  id: number;
  uuid: string;
  deviceId: number;
  deviceName: string;
  at: number;
  warningMinutes: number;
  createdAt: number;
  pushedAt: number | null;
  reconciledAt: number | null;
}

export interface ShutdownTestStore {
  insert(t: {
    uuid: string;
    deviceId: number;
    at: number;
    warningMinutes: number;
    createdBy: number | null;
    createdAt: number;
  }): void;
  /** Tests planned at or after `since` (of one machine when given), oldest first. */
  since(since: number, deviceId?: number): ShutdownTestRow[];
  markPushed(id: number, at: number): void;
  /** Marks the test and its occurrence reconciled, with the counts (ADR-054). */
  markReconciled(id: number, occurrence: string, at: number, counts: Record<string, number>): void;
}

export interface ShutdownTestDeps {
  store: ShutdownTestStore;
  device: (id: number) => { name: string; neverScheduledShutdown: boolean } | undefined;
  readiness: (id: number) => AgentReadiness;
  agenda: Pick<AgendaService, 'invalidate'>;
  power: Pick<PowerOrdersService, 'startScheduled' | 'retryScheduled'>;
  status: Pick<PowerStatusService, 'occurrenceReportsOf' | 'occurrenceDevicesFor'>;
  jobIdByUuid: (uuid: string) => number | null;
  /** v5 of occurrence + device (+ suffix): the same order id on every hub. */
  orderUuid: (occurrence: string, deviceId: number, suffix?: string) => string;
  newUuid: () => string;
  settings: SettingsService;
  audit: AuditService;
  /** v1.4 standby after an import: nothing is pushed or reconciled. */
  standby?: () => boolean;
  transaction: <T>(fn: () => T) => T;
  clock: Clock;
  logger: Logger;
}

export class ShutdownTestService {
  constructor(private readonly d: ShutdownTestDeps) {}

  create(deviceId: number, minutes: number, actor: Actor): ShutdownTest {
    const dev = this.d.device(deviceId);
    if (!dev) throw new AppError('DEVICE_NOT_FOUND', { ids: String(deviceId) });
    if (dev.neverScheduledShutdown) throw new AppError('POWER_TEST_PROTECTED');
    if (this.d.readiness(deviceId) !== 'ready') throw new AppError('POWER_TEST_NOT_READY');
    const now = this.d.clock.now();
    const at = Math.ceil((now + minutes * MIN) / MIN) * MIN;
    // At least one minute between the order and the warning, so the push path can reach it.
    const warningMinutes = Math.max(
      1,
      Math.min(this.d.settings.get('power.defaultWarningMinutes'), minutes - 1),
    );
    const uuid = this.d.newUuid();
    this.d.transaction(() => {
      this.d.store.insert({
        uuid,
        deviceId,
        at,
        warningMinutes,
        createdBy: actor.id,
        createdAt: now,
      });
      this.d.audit.record({
        actor,
        action: 'power.test',
        target: dev.name,
        details: { deviceId, at, minutes, warningMinutes },
      });
    });
    this.d.agenda.invalidate(deviceId);
    this.d.logger.info(
      { deviceId, device: dev.name, at, warningMinutes },
      'scheduled shutdown test created',
    );
    return this.view(
      this.d.store.since(at, deviceId).find((t) => t.uuid === uuid)!,
      now,
    );
  }

  /** The machine's one-offs for its agenda (pull path). */
  oneOffs(deviceId: number): AgendaItem[] {
    const now = this.d.clock.now();
    return this.d.store
      .since(now - AGENDA_LOOKBACK_MS, deviceId)
      .map((t) => ({ occurrence: t.uuid, at: t.at, action: 'shutdown', ...this.policy(t) }));
  }

  /** The latest test of a machine in the last 24 h, with its result once T has passed. */
  latest(deviceId: number): ShutdownTest | null {
    const now = this.d.clock.now();
    const t = this.d.store.since(now - DAY, deviceId).at(-1);
    return t ? this.view(t, now) : null;
  }

  /** The tests planned since `since`, for the history (named like a schedule). */
  forHistory(since: number): TestOccurrence[] {
    return this.d.store
      .since(since)
      .map((t) => ({ uuid: t.uuid, at: t.at, deviceName: t.deviceName, scope: this.scope(t) }));
  }

  /** From the scheduler tick: push due tests, reconcile the ones 10 minutes past T. */
  tick(now = this.d.clock.now()): void {
    if (this.d.standby?.()) return;
    for (const t of this.d.store.since(now - DAY)) {
      if (
        t.pushedAt === null &&
        now >= t.at - (t.warningMinutes + 1) * MIN &&
        now <= t.at + LATE_MS
      ) {
        this.push(t, now);
      }
      if (t.reconciledAt === null && now >= t.at + RECONCILE_AFTER_MS) {
        // One broken test must not stop the others, nor the schedules' reconciliation after it.
        try {
          this.reconcile(t, now);
        } catch (e) {
          this.d.logger.error(
            { err: e, deviceId: t.deviceId },
            'scheduled shutdown test reconciliation failed',
          );
        }
      }
    }
  }

  private push(t: ShutdownTestRow, now: number): void {
    try {
      const r = this.d.power.startScheduled({
        occurrence: t.uuid,
        scheduleName: `"Testar agendamento" de ${t.deviceName}`,
        target: this.target(t),
        policy: this.policy(t),
        excludeTagIds: [],
        plannedAt: t.at,
        orderUuid: (deviceId) => this.d.orderUuid(t.uuid, deviceId),
      });
      this.d.store.markPushed(t.id, now);
      this.d.logger.info(
        { occurrence: t.uuid, deviceId: t.deviceId, device: t.deviceName, plannedAt: t.at, ...r },
        'scheduled shutdown test pushed',
      );
    } catch (e) {
      this.d.logger.error({ err: e, deviceId: t.deviceId }, 'scheduled shutdown test push failed');
    }
  }

  private reconcile(t: ShutdownTestRow, now: number): void {
    const devices = this.devices(t, now);
    const counts: Record<string, number> = {};
    for (const dev of devices) counts[dev.result] = (counts[dev.result] ?? 0) + 1;
    let retried = 0;
    // The same single retry as a schedule's (ADR-054); the job's UUID is the test's.
    const jobId = this.d.jobIdByUuid(t.uuid);
    if (jobId !== null && devices.some((x) => x.result === 'still_on')) {
      const uuid = this.d.orderUuid(t.uuid, t.deviceId, 'retry');
      if (this.d.power.retryScheduled(jobId, t.deviceId, uuid, now + LATE_MS)) retried++;
    }
    this.d.store.markReconciled(t.id, t.uuid, now, { ...counts, retried });
    this.d.logger.info(
      {
        occurrence: t.uuid,
        deviceId: t.deviceId,
        device: t.deviceName,
        plannedAt: t.at,
        counts,
        retried,
      },
      'scheduled shutdown test reconciled',
    );
  }

  private devices(t: ShutdownTestRow, now: number) {
    const rows = this.d.status.occurrenceReportsOf(t.uuid, t.at);
    return this.d.status.occurrenceDevicesFor(t.uuid, rows, this.scope(t), t.at, now);
  }

  private view(t: ShutdownTestRow, now: number): ShutdownTest {
    let result: ShutdownResult | null = null;
    let path: ShutdownTest['path'] = null;
    if (now >= t.at) {
      const dev = this.devices(t, now).find((x) => x.deviceId === t.deviceId);
      result = dev?.result ?? null;
      path = dev?.path ?? null;
    }
    return {
      uuid: t.uuid,
      at: t.at,
      warningMinutes: t.warningMinutes,
      createdAt: t.createdAt,
      pushedAt: t.pushedAt,
      reconciledAt: t.reconciledAt,
      result,
      path,
    };
  }

  private target(t: ShutdownTestRow): WakeTarget {
    return { type: 'devices', deviceIds: [t.deviceId] };
  }

  private policy(t: ShutdownTestRow): PowerPolicy {
    const postponeMax = this.d.settings.get('power.postponeMax');
    return {
      warningMinutes: t.warningMinutes,
      allowPostpone: postponeMax > 0,
      postponeMax,
      postponeMinutes: this.d.settings.get('power.postponeMinutes'),
    };
  }

  private scope(t: ShutdownTestRow): OccurrenceScope {
    const p = this.policy(t);
    return {
      target: this.target(t),
      excludeTags: [],
      warningMinutes: p.warningMinutes,
      allowPostpone: p.allowPostpone,
      postponeMax: p.postponeMax,
      postponeMinutes: p.postponeMinutes,
    };
  }
}
