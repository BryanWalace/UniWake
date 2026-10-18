/**
 * Loads what a lab PC's agenda depends on and calls the pure generator (FR-303.1, ADR-045). Cached
 * per device while the replicated data are unchanged (the change log's highest sequence) and for
 * at most ten minutes, so 500 PCs checking in every minute cost almost nothing (NFR-301).
 */
import type { Agenda, AgendaItem } from '@uniwake/shared';
import {
  buildAgenda,
  explainAgenda,
  type AgendaExplanation,
  type AgendaDevice,
  type AgendaPause,
  type AgendaSchedule,
} from '../../domain/agenda';
import type { ExceptionRange } from '../../domain/schedule';
import type { Clock, Logger } from '../ports';
import { rowsToTarget, type ScheduleRecord, type TargetRefs } from '../schedules/schedules-service';

export interface AgendaDeps {
  schedules: () => ScheduleRecord[];
  exceptions: () => ExceptionRange[];
  pause: () => AgendaPause | null;
  device: (deviceId: number) => AgendaDevice | undefined;
  refs: TargetRefs;
  /** Changes whenever any replicated data change (highest change-log sequence). */
  dataVersion: () => number;
  occurrenceId: (scheduleUuid: string, at: number) => string;
  digest: (text: string) => string;
  /** v1.6 (FR-504.3): this machine's "Testar agendamento" one-offs. */
  oneOffs?: (deviceId: number) => AgendaItem[];
  /** FR-504.2: "agenda changed" when a machine's agenda gets a new version. */
  logger?: Logger;
  clock: Clock;
}

const BUCKET_MS = 10 * 60_000;

export class AgendaService {
  private cache = new Map<number, { key: string; agenda: Agenda }>();
  private cachedVersion = -1;
  /** Last version built per machine in this process (FR-504.2 "agenda changed"). */
  private readonly lastVersion = new Map<number, string>();

  constructor(private readonly d: AgendaDeps) {}

  forDevice(deviceId: number): Agenda | null {
    const now = this.d.clock.now();
    const version = this.d.dataVersion();
    if (version !== this.cachedVersion) {
      this.cache = new Map();
      this.cachedVersion = version;
    }
    const key = `${version}:${Math.floor(now / BUCKET_MS)}`;
    const hit = this.cache.get(deviceId);
    if (hit?.key === key) return hit.agenda;
    const device = this.d.device(deviceId);
    if (!device) return null;
    const agenda = buildAgenda({
      device,
      schedules: this.schedules(),
      exceptions: this.d.exceptions(),
      pause: this.d.pause(),
      now,
      occurrenceId: this.d.occurrenceId,
      digest: this.d.digest,
      oneOffs: this.d.oneOffs?.(deviceId) ?? [],
    });
    this.cache.set(deviceId, { key, agenda });
    const previous = this.lastVersion.get(deviceId);
    if (previous !== agenda.version) {
      this.lastVersion.set(deviceId, agenda.version);
      if (previous !== undefined) {
        this.d.logger?.info(
          {
            deviceId,
            version: agenda.version,
            previous,
            items: agenda.items.length,
            next: agenda.items.find((i) => i.at > now)?.at ?? null,
          },
          'agenda changed',
        );
      }
    }
    return agenda;
  }

  /** A machine-local change of one machine's agenda (a "Testar agendamento" one-off). */
  invalidate(deviceId: number): void {
    this.cache.delete(deviceId);
  }

  /** FR-502.1: each shutdown schedule with why it does (not) reach this machine. */
  explain(deviceId: number): AgendaExplanation[] {
    const device = this.d.device(deviceId);
    if (!device) return [];
    return explainAgenda({
      device,
      schedules: this.schedules(),
      exceptions: this.d.exceptions(),
      pause: this.d.pause(),
      now: this.d.clock.now(),
      occurrenceId: this.d.occurrenceId,
      digest: this.d.digest,
    });
  }

  private schedules(): AgendaSchedule[] {
    return this.d
      .schedules()
      .filter((s) => s.uuid)
      .map((s) => ({
        id: s.id,
        uuid: s.uuid!,
        enabled: s.enabled,
        action: s.action ?? 'wake',
        weekdays: s.weekdays,
        timeLocal: s.timeLocal,
        timezone: s.timezone,
        target: rowsToTarget(s.targets, this.d.refs),
        warningMinutes: s.warningMinutes ?? null,
        allowPostpone: s.allowPostpone ?? null,
        postponeMax: s.postponeMax ?? null,
        postponeMinutes: s.postponeMinutes ?? null,
        excludeTags: s.excludeTags ?? [],
        savedAt: s.updatedAt,
      }));
  }
}
