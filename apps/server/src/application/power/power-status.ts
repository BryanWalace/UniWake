/**
 * What the panel shows about remote shutdown (FR-307, FR-308.3, FR-309): each machine's agent and
 * readiness, the counts for "Saúde do sistema" (owner Q-5), and the history of scheduled
 * shutdowns aggregated per occurrence from the machines' reports — including the ones run while
 * the hub was off, which arrive later.
 */
import type {
  DeviceAgentInfo,
  PowerHistory,
  PowerOccurrence,
  PowerOccurrenceDevice,
  WakeTarget,
} from '@uniwake/shared';
import { agentReadiness, type AgentReadiness } from '../../domain/readiness';
import type { DeviceSnap } from '../../domain/scope';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import { rowsToTarget, type ScheduleRecord, type TargetRefs } from '../schedules/schedules-service';
import type { PowerOrdersService } from './power-orders';

export interface AgentRowView {
  deviceId: number;
  name: string;
  neverScheduledShutdown: boolean;
  tagUuids?: string[];
  hasToken: boolean;
  rotatedAt: number | null;
  revokedAt: number | null;
  agentVersion: string | null;
  freezeProduct: string | null;
  freezeState: string | null;
  persistent: boolean;
  sleepAfterMinutes: number | null;
  wakeTimers: string | null;
  lastCheckin: number | null;
  clockOffsetMs: number | null;
  userLoggedOn: boolean | null;
  sessions: number | null;
  status: string;
  onlineSince: number | null;
  bootTime?: number | null;
}

export interface ReportRow {
  occurrence: string;
  deviceId: number;
  deviceName: string;
  action: 'shutdown' | 'restart';
  outcome: 'done' | 'cancelled' | 'skipped' | 'failed';
  reason: string | null;
  plannedAt: number | null;
  executedAt: number | null;
  postpones: number;
  wasAsleep: boolean;
  lateMinutes: number | null;
  nativeWarning: boolean;
  userLoggedOn: boolean | null;
}

export interface PowerStatusDeps {
  agents: (deviceIds?: readonly number[]) => AgentRowView[];
  /** Reports of scheduled occurrences planned since `since`, oldest first. */
  occurrenceReports: (since: number) => ReportRow[];
  /** Boot time and tags per device (inference and exclusions). */
  deviceExtras: (
    ids: readonly number[],
  ) => Map<number, { bootTime: number | null; tagUuids: string[] }>;
  schedules: () => ScheduleRecord[];
  refs: TargetRefs;
  resolve: (target: WakeTarget) => { devices: DeviceSnap[] };
  occurrenceId: (scheduleUuid: string, at: number) => string;
  recentJobIds: (limit: number) => number[];
  orders: PowerOrdersService;
  clock: Clock;
}

const DAY = 86_400_000;
const HISTORY_DAYS = 30;

export class PowerStatusService {
  constructor(private readonly d: PowerStatusDeps) {}

  private readiness(r: AgentRowView, now: number): AgentReadiness {
    return agentReadiness(
      {
        hasToken: r.hasToken,
        revoked: r.revokedAt !== null,
        lastCheckin: r.lastCheckin,
        online: r.status === 'online',
        onlineSince: r.onlineSince,
      },
      now,
    );
  }

  private view(r: AgentRowView, now: number): DeviceAgentInfo {
    return {
      deviceId: r.deviceId,
      readiness: this.readiness(r, now),
      agentVersion: r.agentVersion,
      lastCheckin: r.lastCheckin,
      freezeProduct: r.freezeProduct,
      freezeState: r.freezeState,
      persistentArea: r.persistent,
      sleepAfterMinutes: r.sleepAfterMinutes,
      wakeTimers: r.wakeTimers,
      userLoggedOn: r.userLoggedOn,
      sessions: r.sessions,
      clockOffsetMs: r.clockOffsetMs,
      tokenRotatedAt: r.rotatedAt,
    };
  }

  /** Every machine's agent (device list badges, FR-309). */
  list(): DeviceAgentInfo[] {
    const now = this.d.clock.now();
    return this.d.agents().map((r) => this.view(r, now));
  }

  device(deviceId: number): DeviceAgentInfo {
    const r = this.d.agents([deviceId])[0];
    if (!r) throw new AppError('DEVICE_NOT_FOUND', { ids: String(deviceId) });
    return this.view(r, this.d.clock.now());
  }

  /** Counts for "Saúde do sistema" (Q-5: how many are "perdido"). */
  counts(): Record<AgentReadiness, number> {
    const now = this.d.clock.now();
    const out: Record<AgentReadiness, number> = {
      ready: 0,
      needs_preparation: 0,
      revoked: 0,
      lost: 0,
    };
    for (const r of this.d.agents()) out[this.readiness(r, now)]++;
    return out;
  }

  /**
   * Scheduled shutdowns of the last 30 days, one row per occurrence (AC-307-01), and the recent
   * manual jobs. A prepared machine the schedule targets that sent no report counts as
   * "provavelmente desligou (sem relatório)" when its next check-in shows a boot after T (frozen
   * machines lose queued reports at restart), and as "sem relatório" after 24 h otherwise.
   */
  history(limit = 50): PowerHistory {
    const now = this.d.clock.now();
    const reports = this.d.occurrenceReports(now - HISTORY_DAYS * DAY);
    const groups = new Map<string, ReportRow[]>();
    for (const r of reports) {
      let g = groups.get(r.occurrence);
      if (!g) groups.set(r.occurrence, (g = []));
      g.push(r);
    }
    const schedules = this.d.schedules().filter((s) => s.uuid && s.action === 'shutdown');
    const occurrences: PowerOccurrence[] = [];
    for (const [occurrence, rows] of groups) {
      const plannedAt = rows.find((r) => r.plannedAt !== null)?.plannedAt ?? null;
      const schedule =
        plannedAt === null
          ? undefined
          : schedules.find((s) => this.d.occurrenceId(s.uuid!, plannedAt) === occurrence);
      const devices: PowerOccurrenceDevice[] = rows.map((r) => ({
        deviceId: r.deviceId,
        name: r.deviceName,
        result: resultOf(r),
        postpones: r.postpones,
        wasAsleep: r.wasAsleep,
        lateMinutes: r.lateMinutes,
        nativeWarning: r.nativeWarning,
        userLoggedOn: r.userLoggedOn,
      }));
      if (schedule && plannedAt !== null) {
        devices.push(
          ...this.missing(schedule, plannedAt, new Set(rows.map((r) => r.deviceId)), now),
        );
      }
      const counts: PowerOccurrence['counts'] = {
        done: 0,
        postponed: 0,
        was_off: 0,
        late_wake: 0,
        cancelled: 0,
        failed: 0,
        probably_done: 0,
        no_report: 0,
      };
      for (const dev of devices) {
        counts[dev.result]++;
        if (dev.result === 'done' && dev.postpones > 0) counts.postponed++;
      }
      occurrences.push({
        occurrence,
        scheduleId: schedule?.id ?? null,
        scheduleName: schedule?.name ?? null,
        plannedAt,
        counts,
        maxPostpones: Math.max(0, ...devices.map((x) => x.postpones)),
        devices: devices.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    occurrences.sort((a, b) => (b.plannedAt ?? 0) - (a.plannedAt ?? 0));
    return {
      occurrences: occurrences.slice(0, limit),
      jobs: this.d.recentJobIds(limit).map((id) => this.d.orders.get(id)),
    };
  }

  /** Prepared machines the schedule targets that have not reported this occurrence. */
  private missing(
    schedule: ScheduleRecord,
    plannedAt: number,
    reported: Set<number>,
    now: number,
  ): PowerOccurrenceDevice[] {
    const targeted = this.d
      .resolve(rowsToTarget(schedule.targets, this.d.refs))
      .devices.filter((d) => !reported.has(d.id));
    if (targeted.length === 0) return [];
    const agents = new Map(this.d.agents(targeted.map((d) => d.id)).map((a) => [a.deviceId, a]));
    const extras = this.d.deviceExtras(targeted.map((d) => d.id));
    const exclude = new Set(schedule.excludeTags ?? []);
    const out: PowerOccurrenceDevice[] = [];
    for (const dev of targeted) {
      const a = agents.get(dev.id);
      const x = extras.get(dev.id);
      if (!a?.hasToken || a.neverScheduledShutdown) continue;
      if (x?.tagUuids.some((t) => exclude.has(t))) continue;
      const booted = typeof x?.bootTime === 'number' && x.bootTime > plannedAt;
      const result = booted ? 'probably_done' : now - plannedAt > DAY ? 'no_report' : null;
      if (result === null) continue; // may still report
      out.push({
        deviceId: dev.id,
        name: dev.name,
        result,
        postpones: 0,
        wasAsleep: false,
        lateMinutes: null,
        nativeWarning: false,
        userLoggedOn: null,
      });
    }
    return out;
  }
}

function resultOf(r: ReportRow): PowerOccurrenceDevice['result'] {
  if (r.outcome === 'done') return 'done';
  if (r.outcome === 'cancelled') return 'cancelled';
  if (r.outcome === 'skipped') return r.reason === 'late_wake' ? 'late_wake' : 'was_off';
  return 'failed';
}
