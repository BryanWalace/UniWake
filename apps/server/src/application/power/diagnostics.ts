/**
 * Why a machine will or will not shut down on a schedule (FR-502.1, FR-504.1, ADR-056): the agenda
 * the hub last served it and the one it would serve now, each shutdown schedule with the reason
 * it includes the machine or not (the agenda's own rules), and the last shutdown result with the
 * path that ran it.
 */
import type { ShutdownDiagnostics } from '@uniwake/shared';
import type { AgendaReason } from '../../domain/agenda';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import type { AgendaService } from './agenda-service';
import { type ReportRow, resultOf } from './power-status';
import type { ShutdownTestService } from './shutdown-test';

export interface DiagnosticsStore {
  served(
    deviceId: number,
  ): { version: string | null; items: number | null; at: number | null } | null;
  lastReport(deviceId: number): {
    at: number;
    outcome: ReportRow['outcome'];
    reason: string | null;
    order: string | null;
    detail: string | null;
  } | null;
  scheduleName(id: number): string | null;
  deviceExists(id: number): boolean;
}

export class ShutdownDiagnosticsService {
  constructor(
    private readonly d: {
      agenda: Pick<AgendaService, 'forDevice' | 'explain'>;
      store: DiagnosticsStore;
      /** FR-504.3: the latest "Testar agendamento" (absent in tests that do not need it). */
      tests?: Pick<ShutdownTestService, 'latest'>;
      clock: Clock;
    },
  ) {}

  forDevice(deviceId: number): ShutdownDiagnostics {
    if (!this.d.store.deviceExists(deviceId)) {
      throw new AppError('DEVICE_NOT_FOUND', { ids: String(deviceId) });
    }
    const current = this.d.agenda.forDevice(deviceId);
    const served = this.d.store.served(deviceId);
    return {
      agenda: {
        servedVersion: served?.version ?? null,
        servedItems: served?.items ?? null,
        servedAt: served?.at ?? null,
        currentVersion: current?.version ?? null,
        currentItems: current?.items.length ?? 0,
        nextShutdownAt: current?.items.find((i) => i.at > this.d.clock.now())?.at ?? null,
      },
      schedules: this.d.agenda.explain(deviceId).map((x) => ({
        scheduleId: x.scheduleId,
        name: this.d.store.scheduleName(x.scheduleId) ?? '?',
        reason: x.reason satisfies AgendaReason,
        nextAt: x.nextAt,
      })),
      lastShutdown: (() => {
        const r = this.d.store.lastReport(deviceId);
        if (!r) return null;
        return {
          at: r.at,
          result: resultOf(r),
          path: r.order ? 'order' : 'agenda',
          detail: r.detail,
        };
      })(),
      test: this.d.tests?.latest(deviceId) ?? null,
    };
  }
}
