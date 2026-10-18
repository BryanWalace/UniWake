/**
 * Reconciliation of scheduled shutdowns (FR-501.4, ADR-054): ten minutes after T, the hub that
 * pushed an occurrence classifies each targeted machine (desligou + path, adiado, ainda ligado, sem
 * agente, agenda desatualizada, sem resposta), sends one retry order to the ones still on without a
 * reason, writes the counts to the schedule run and logs them. Each occurrence is reconciled once.
 */
import {
  EXCLUDED_REASON_LABEL,
  type ExcludedReason,
  SHUTDOWN_RESULT_LABEL,
  type ShutdownResult,
} from '@uniwake/shared';
import type { Clock, Logger } from '../ports';
import type { ScheduleRecord } from '../schedules/schedules-service';
import type { PowerOrdersService } from './power-orders';
import type { PowerStatusService } from './power-status';

export const RECONCILE_AFTER_MS = 10 * 60_000;
const DAY = 86_400_000;

export interface ReconcileStore {
  /** Shutdown runs this hub pushed with T in [from, to] (executado/atrasado). */
  pushedRuns(from: number, to: number): { runId: number; scheduleId: number; plannedAt: number }[];
  isReconciled(occurrence: string): boolean;
  markReconciled(occurrence: string, at: number, counts: Record<string, number>): void;
  appendRunDetail(runId: number, text: string): void;
}

export interface ReconcileDeps {
  store: ReconcileStore;
  schedule: (id: number) => ScheduleRecord | undefined;
  status: Pick<PowerStatusService, 'occurrenceDevices' | 'occurrenceReportsOf'>;
  power: Pick<PowerOrdersService, 'retryScheduled'>;
  jobIdByUuid: (uuid: string) => number | null;
  occurrenceId: (scheduleUuid: string, at: number) => string;
  /** v5 of occurrence + device + suffix: the same retry id on every hub. */
  orderUuid: (occurrence: string, deviceId: number, suffix: string) => string;
  clock: Clock;
  logger: Logger;
}

const SUMMARY_ORDER: readonly ShutdownResult[] = [
  'done',
  'off_no_report',
  'probably_done',
  'postponed_active',
  'still_on',
  'no_agent',
  'stale_agenda',
  'no_answer',
  'was_off',
  'late_wake',
  'cancelled',
  'failed',
  'no_report',
];

/** FR-601.2: "2 excluídas do agendamento (1 nunca desligar por agendamento, 1 etiqueta …)". */
function excludedText(devices: readonly { result: string; excludedReason?: ExcludedReason }[]) {
  const reasons = new Map<ExcludedReason, number>();
  for (const d of devices) {
    if (d.result === 'excluded' && d.excludedReason) {
      reasons.set(d.excludedReason, (reasons.get(d.excludedReason) ?? 0) + 1);
    }
  }
  const total = [...reasons.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const why = [...reasons].map(([r, n]) => `${n} ${EXCLUDED_REASON_LABEL[r].toLowerCase()}`);
  return [`${total} ${total === 1 ? 'excluída' : 'excluídas'} do agendamento (${why.join(', ')})`];
}

export class ShutdownReconciler {
  constructor(private readonly d: ReconcileDeps) {}

  tick(now = this.d.clock.now()): number {
    let done = 0;
    for (const run of this.d.store.pushedRuns(now - DAY, now - RECONCILE_AFTER_MS)) {
      const s = this.d.schedule(run.scheduleId);
      if (!s?.uuid) continue;
      const occurrence = this.d.occurrenceId(s.uuid, run.plannedAt);
      if (this.d.store.isReconciled(occurrence)) continue;
      const rows = this.d.status.occurrenceReportsOf(occurrence, run.plannedAt);
      const devices = this.d.status.occurrenceDevices(occurrence, rows, s, run.plannedAt, now);
      const counts: Record<string, number> = {};
      const paths = { agenda: 0, order: 0 };
      for (const dev of devices) {
        counts[dev.result] = (counts[dev.result] ?? 0) + 1;
        if (dev.result === 'done' && dev.path) paths[dev.path]++;
      }
      // One retry through the push path for machines still on without a reason (ADR-054).
      const jobId = this.d.jobIdByUuid(occurrence);
      let retried = 0;
      if (jobId !== null) {
        for (const dev of devices) {
          if (dev.result !== 'still_on') continue;
          const uuid = this.d.orderUuid(occurrence, dev.deviceId, 'retry');
          if (this.d.power.retryScheduled(jobId, dev.deviceId, uuid, now + 60 * 60_000)) retried++;
        }
      }
      const summary = [
        ...SUMMARY_ORDER.filter((r) => (counts[r] ?? 0) > 0).map(
          (r) => `${counts[r]} ${SHUTDOWN_RESULT_LABEL[r].toLowerCase()}`,
        ),
        ...excludedText(devices),
      ].join(', ');
      const text =
        `; conferência às T+10: ${summary || 'nenhuma máquina no alvo'}` +
        (paths.agenda + paths.order > 0
          ? ` (pela agenda: ${paths.agenda}, por ordem direta: ${paths.order})`
          : '') +
        (retried > 0 ? `; nova tentativa para ${retried}` : '');
      this.d.store.appendRunDetail(run.runId, text);
      this.d.store.markReconciled(occurrence, now, { ...counts, retried });
      this.d.logger.info(
        {
          occurrence,
          scheduleId: s.id,
          schedule: s.name,
          plannedAt: run.plannedAt,
          counts,
          paths,
          retried,
        },
        'scheduled shutdown reconciled',
      );
      done++;
    }
    return done;
  }
}
