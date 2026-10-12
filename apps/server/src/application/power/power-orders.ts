/**
 * Manual "Desligar" and "Reiniciar" (FR-305, plan §15.5). The hub never runs a shutdown command:
 * it creates one order per ready machine, delivered at the machine's next check-in (≤ 1 min), and
 * follows the job from the machines' reports and the monitor (offline confirms a shutdown; coming
 * back online after the order confirms a restart).
 */
import {
  MANUAL_WARNING_MINUTES,
  ORDER_EXPIRY_MINUTES,
  POWER_DEVICE_STATES,
  POSTPONE_MINUTES_MIN,
  type PowerDeviceRef,
  type PowerDeviceState,
  type PowerJob,
  type PowerPolicy,
  type PowerPreview,
  type PowerRequestParams,
  type WakeTarget,
} from '@uniwake/shared';
import type { DeviceSnap } from '../../domain/scope';
import { agentReadiness, type ReadinessInput } from '../../domain/readiness';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { EventsBus } from '../events-bus';
import type { Clock } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import type { WakePreview } from '@uniwake/shared';

/** What readiness and the preview need about one machine (FR-305, FR-309). */
export interface PowerDeviceInfo extends ReadinessInput {
  userLoggedOn: boolean | null;
  neverScheduledShutdown: boolean;
}

export interface JobRow {
  id: number;
  uuid: string;
  action: 'shutdown' | 'restart';
  label: string;
  policy: PowerPolicy;
  createdAt: number;
  createdBy: string | null;
}

export interface JobOrderRow {
  deviceId: number;
  name: string;
  state: 'pending' | 'delivered' | 'executed' | 'cancelled' | 'expired' | 'failed' | 'warning';
  expiresAt: number;
  executedAt: number | null;
  detail: string | null;
  postpones: number;
  /** Monitor (device_state). */
  status: string;
  onlineSince: number | null;
}

export interface PowerJobsStore {
  info(deviceIds: readonly number[]): Map<number, PowerDeviceInfo>;
  createJob(
    job: Omit<JobRow, 'id' | 'createdBy'> & { target: WakeTarget; createdBy: number | null },
    orders: { uuid: string; deviceId: number; expiresAt: number }[],
  ): number;
  job(id: number): JobRow | undefined;
  jobOrders(id: number): JobOrderRow[];
  /** Cancels the job's open orders; returns how many. */
  cancelJob(id: number, at: number): number;
}

export interface PowerOrdersDeps {
  store: PowerJobsStore;
  resolve: (target: WakeTarget) => {
    devices: DeviceSnap[];
    rooms: WakePreview['rooms'];
    needsConfirmation: boolean;
    label: string;
    auditTarget: string;
  };
  settings: SettingsService;
  audit: AuditService;
  events: EventsBus;
  clock: Clock;
  transaction: <T>(fn: () => T) => T;
  newUuid: () => string;
}

const MINUTE = 60_000;
/** A shutdown still answering ping/TCP this long after it ran is "não confirmou" (AC-305-02). */
export const CONFIRM_SHUTDOWN_MS = 5 * MINUTE;
/** A restart that has not come back online after this long is "não confirmou". */
export const CONFIRM_RESTART_MS = 10 * MINUTE;

const ref = (d: { id: number; name: string }): PowerDeviceRef => ({ deviceId: d.id, name: d.name });

export class PowerOrdersService {
  constructor(private readonly d: PowerOrdersDeps) {}

  /** Q-7: 1 min without postpone, or the schedules' defaults ("5 min com adiamento"). */
  policy(option: PowerRequestParams['warning']): PowerPolicy {
    if (option === 'short') {
      return {
        warningMinutes: MANUAL_WARNING_MINUTES,
        allowPostpone: false,
        postponeMax: 0,
        postponeMinutes: POSTPONE_MINUTES_MIN,
      };
    }
    const max = this.d.settings.get('power.postponeMax');
    return {
      warningMinutes: this.d.settings.get('power.defaultWarningMinutes'),
      allowPostpone: max > 0,
      postponeMax: max,
      postponeMinutes: this.d.settings.get('power.postponeMinutes'),
    };
  }

  private plan(req: PowerRequestParams) {
    const r = this.d.resolve(req.target);
    const info = this.d.store.info(r.devices.map((d) => d.id));
    const ready: DeviceSnap[] = [];
    const needsPreparation: PowerDeviceRef[] = [];
    const revoked: PowerDeviceRef[] = [];
    const lost: PowerDeviceRef[] = [];
    const now = this.d.clock.now();
    for (const dev of r.devices) {
      const i = info.get(dev.id);
      // AC-309-01: only ready machines receive orders.
      const state = i ? agentReadiness(i, now) : 'needs_preparation';
      if (state === 'needs_preparation') needsPreparation.push(ref(dev));
      else if (state === 'revoked') revoked.push(ref(dev));
      else if (state === 'lost') lost.push(ref(dev));
      else ready.push(dev);
    }
    const protectedDevs = ready.filter((dev) => info.get(dev.id)?.neverScheduledShutdown);
    return { r, info, ready, needsPreparation, revoked, lost, protectedDevs };
  }

  preview(req: PowerRequestParams): PowerPreview {
    const { r, info, ready, needsPreparation, revoked, lost, protectedDevs } = this.plan(req);
    return {
      lost,
      action: req.action,
      count: ready.length,
      rooms: r.rooms,
      needsConfirmation: r.needsConfirmation,
      needsPreparation,
      revoked,
      withUser: ready.filter((dev) => info.get(dev.id)?.userLoggedOn === true).length,
      offline: ready.filter((dev) => dev.status !== 'online').length,
      protected: protectedDevs.map(ref),
      policy: this.policy(req.warning),
    };
  }

  /** Creates the job and one order per ready machine (AC-305-01, AC-305-04). */
  start(req: PowerRequestParams, actor: Actor): { jobId: number; count: number } {
    const { r, ready, protectedDevs } = this.plan(req);
    if (r.devices.length === 0) throw new AppError('POWER_TARGET_EMPTY');
    if (ready.length === 0) throw new AppError('POWER_NOT_READY');
    if (protectedDevs.length > 0 && !req.confirmProtected) {
      throw new AppError(
        'POWER_PROTECTED_CONFIRMATION',
        {},
        {
          devices: protectedDevs.map(ref),
        },
      );
    }
    if (r.needsConfirmation && req.confirm?.count !== ready.length) {
      throw new AppError(
        'CONFIRMATION_REQUIRED',
        { count: ready.length },
        { count: ready.length, rooms: r.rooms },
      );
    }
    const now = this.d.clock.now();
    const policy = this.policy(req.warning);
    const expiresAt = now + ORDER_EXPIRY_MINUTES * MINUTE;
    const jobId = this.d.transaction(() => {
      const id = this.d.store.createJob(
        {
          uuid: this.d.newUuid(),
          action: req.action,
          label: r.label,
          target: req.target,
          policy,
          createdAt: now,
          createdBy: actor.id,
        },
        ready.map((dev) => ({ uuid: this.d.newUuid(), deviceId: dev.id, expiresAt })),
      );
      this.d.audit.record({
        actor,
        action: req.action === 'shutdown' ? 'power.shutdown' : 'power.restart',
        target: r.auditTarget,
        details: {
          jobId: id,
          count: ready.length,
          warningMinutes: policy.warningMinutes,
          postponeMax: policy.postponeMax,
          ...(protectedDevs.length > 0 ? { protected: protectedDevs.map((x) => x.name) } : {}),
        },
      });
      return id;
    });
    this.d.events.publish({ type: 'power.job', jobId });
    return { jobId, count: ready.length };
  }

  get(jobId: number): PowerJob {
    const job = this.d.store.job(jobId);
    if (!job) throw new AppError('POWER_JOB_NOT_FOUND');
    const now = this.d.clock.now();
    const devices = this.d.store.jobOrders(jobId).map((o) => ({
      deviceId: o.deviceId,
      name: o.name,
      state: deviceState(job.action, o, now),
      postpones: o.postpones,
      detail: o.detail,
    }));
    const counts = Object.fromEntries(POWER_DEVICE_STATES.map((s) => [s, 0])) as Record<
      PowerDeviceState,
      number
    >;
    for (const dev of devices) counts[dev.state]++;
    return {
      id: job.id,
      action: job.action,
      label: job.label,
      createdAt: job.createdAt,
      createdBy: job.createdBy,
      policy: job.policy,
      expiresAt: Math.max(...this.d.store.jobOrders(jobId).map((o) => o.expiresAt), job.createdAt),
      counts,
      devices,
    };
  }

  /** "Cancelar": orders not yet run are cancelled; delivered ones get a cancel at the next check-in. */
  cancel(jobId: number, actor: Actor): PowerJob {
    const job = this.d.store.job(jobId);
    if (!job) throw new AppError('POWER_JOB_NOT_FOUND');
    this.d.transaction(() => {
      const n = this.d.store.cancelJob(jobId, this.d.clock.now());
      this.d.audit.record({
        actor,
        action: 'power.cancel',
        target: job.label,
        details: { jobId, cancelled: n },
      });
    });
    this.d.events.publish({ type: 'power.job', jobId });
    return this.get(jobId);
  }
}

/** The panel state of one machine of a job, from its order and the monitor (AC-305-02). */
export function deviceState(
  action: 'shutdown' | 'restart',
  o: Pick<JobOrderRow, 'state' | 'executedAt' | 'status' | 'onlineSince'>,
  now: number,
): PowerDeviceState {
  switch (o.state) {
    case 'pending':
      return 'pending';
    case 'delivered':
    case 'warning':
      return 'received';
    case 'cancelled':
    case 'expired':
    case 'failed':
      return o.state;
    case 'executed':
      break;
  }
  const at = o.executedAt ?? now;
  const backOnline = o.status === 'online' && o.onlineSince !== null && o.onlineSince > at;
  if (action === 'restart') {
    if (backOnline) return 'done';
    return now - at > CONFIRM_RESTART_MS ? 'not_confirmed' : 'confirming';
  }
  if (o.status !== 'online' || backOnline) return 'done';
  return now - at > CONFIRM_SHUTDOWN_MS ? 'not_confirmed' : 'confirming';
}
