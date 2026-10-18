/**
 * A lab PC's shutdown agenda (FR-303.1, ADR-045, owner Q-1/Q-4). Pure: from the schedules, the
 * exceptions and the pause, the concrete shutdown instants inside an explicit window, plus the
 * PC's wake instants (late-wake rule). Holidays, vacations, paused days and excluded machines
 * simply produce no item, so the PC never evaluates a rule itself.
 */
import {
  AGENDA_DAYS,
  AGENDA_MAX_ITEMS,
  type Agenda,
  type AgendaItem,
  type WakeTarget,
} from '@uniwake/shared';
import { exceptionFor, type ExceptionRange, occurrencesBetween } from './schedule';
import { targetMatches, type DeviceSnap } from './scope';

const DAY = 86_400_000;

/**
 * Items whose time passed less than this long ago stay listed, so a PC that checks in during a
 * warning, a postpone or a late wake (≤ 60 min) still knows the item it is handling. The PC's own
 * rules (done ids, boot time, late-wake cap) decide whether it may still run.
 */
export const AGENDA_LOOKBACK_MS = 6 * 3_600_000;

export interface AgendaSchedule {
  id: number;
  /** Global identity: occurrence ids derive from it. */
  uuid: string;
  enabled: boolean;
  action: 'wake' | 'shutdown';
  weekdays: number;
  timeLocal: string;
  timezone: string;
  target: WakeTarget;
  /** Shutdown schedules only (null for wake schedules). */
  warningMinutes: number | null;
  allowPostpone: boolean | null;
  postponeMax: number | null;
  postponeMinutes: number | null;
  /** Tag UUIDs whose machines this shutdown schedule skips (FR-306.2). */
  excludeTags: readonly string[];
  /** Last save (create, edit, enable): earlier shutdown instants are never listed (ADR-058). */
  savedAt?: number;
}

export interface AgendaDevice extends Pick<DeviceSnap, 'id' | 'roomId' | 'tagIds' | 'enabled'> {
  tagUuids: readonly string[];
  /** "Nunca desligar por agendamento" (FR-306.2). */
  neverScheduledShutdown: boolean;
}

export interface AgendaPause {
  since: number;
  resumeAt: number | null;
}

export interface AgendaInput {
  device: AgendaDevice;
  schedules: readonly AgendaSchedule[];
  exceptions: readonly ExceptionRange[];
  pause: AgendaPause | null;
  now: number;
  /** Deterministic occurrence UUID (ADR-031: v5 of schedule UUID + planned instant). */
  occurrenceId: (scheduleUuid: string, at: number) => string;
  /** Hex digest of a string (SHA-256 in the application layer): the agenda version. */
  digest: (text: string) => string;
  /**
   * v1.6 "Testar agendamento" (FR-504.3, ADR-056): one-off shutdowns of this machine. An explicit
   * test, so holidays, the pause and the exclusions do not apply; a disabled machine gets none.
   */
  oneOffs?: readonly AgendaItem[];
}

const matchesDevice = (s: AgendaSchedule, d: AgendaDevice) =>
  targetMatches(s.target, {
    id: d.id,
    roomId: d.roomId,
    tagIds: d.tagIds,
  });

function excluded(s: AgendaSchedule, d: AgendaDevice): boolean {
  return d.neverScheduledShutdown || d.tagUuids.some((t) => s.excludeTags.includes(t));
}

/** Instants of one schedule in `(from, to]` that are not holidays, vacations or paused. */
function instants(s: AgendaSchedule, input: AgendaInput, from: number, to: number): number[] {
  const paused = (at: number) =>
    input.pause !== null &&
    at >= input.pause.since &&
    (input.pause.resumeAt === null || at < input.pause.resumeAt);
  return occurrencesBetween(s, from, to)
    .filter((o) => exceptionFor(o.day, input.exceptions, s.id) === null && !paused(o.at))
    .map((o) => o.at);
}

/** Why a shutdown schedule does (not) reach a machine (FR-502.1), with the same rules as the agenda. */
export type AgendaReason =
  | 'included'
  | 'schedule_disabled'
  | 'device_disabled'
  | 'not_in_target'
  | 'never_flag'
  | 'excluded_tag'
  | 'no_occurrence';

export interface AgendaExplanation {
  scheduleId: number;
  reason: AgendaReason;
  /** Next shutdown of this schedule for the machine inside the window, when included. */
  nextAt: number | null;
}

export function explainAgenda(input: AgendaInput): AgendaExplanation[] {
  const { device, now } = input;
  const to = now + AGENDA_DAYS * DAY;
  return input.schedules
    .filter((s) => s.action === 'shutdown')
    .map((s): AgendaExplanation => {
      const reason: AgendaReason = !s.enabled
        ? 'schedule_disabled'
        : !device.enabled
          ? 'device_disabled'
          : !matchesDevice(s, device)
            ? 'not_in_target'
            : device.neverScheduledShutdown
              ? 'never_flag'
              : excluded(s, device)
                ? 'excluded_tag'
                : 'included';
      if (reason !== 'included') return { scheduleId: s.id, reason, nextAt: null };
      const next = instants(s, input, now, to)[0] ?? null;
      return {
        scheduleId: s.id,
        reason: next === null ? 'no_occurrence' : 'included',
        nextAt: next,
      };
    });
}

export function buildAgenda(input: AgendaInput): Agenda {
  const { device, now } = input;
  const from = now - AGENDA_LOOKBACK_MS;
  let to = now + AGENDA_DAYS * DAY;
  const active = input.schedules.filter(
    (s) => s.enabled && device.enabled && matchesDevice(s, device),
  );

  // One item per instant: two schedules at the same minute shut the PC down once (the smaller
  // occurrence id wins, the same on every hub).
  const byInstant = new Map<number, AgendaItem>();
  for (const s of active) {
    if (s.action !== 'shutdown' || excluded(s, device)) continue;
    for (const at of instants(s, input, Math.max(from, s.savedAt ?? from), to)) {
      const item: AgendaItem = {
        occurrence: input.occurrenceId(s.uuid, at),
        at,
        action: 'shutdown',
        warningMinutes: s.warningMinutes ?? 5,
        allowPostpone: s.allowPostpone ?? true,
        postponeMax: s.postponeMax ?? 2,
        postponeMinutes: s.postponeMinutes ?? 15,
      };
      const other = byInstant.get(at);
      if (!other || item.occurrence < other.occurrence) byInstant.set(at, item);
    }
  }
  if (device.enabled) {
    for (const item of input.oneOffs ?? []) {
      if (item.at <= from || item.at > to) continue;
      const other = byInstant.get(item.at);
      if (!other || item.occurrence < other.occurrence) byInstant.set(item.at, item);
    }
  }
  let items = [...byInstant.values()].sort((a, b) => a.at - b.at);
  if (items.length > AGENDA_MAX_ITEMS) {
    // The PC must know where its knowledge ends: shrink the window instead of dropping silently.
    items = items.slice(0, AGENDA_MAX_ITEMS);
    to = items[items.length - 1]!.at;
  }

  const wakes = new Set<number>();
  for (const s of active) {
    if (s.action !== 'wake') continue;
    for (const at of instants(s, input, now, to)) wakes.add(at);
  }
  const nextWakes = [...wakes].sort((a, b) => a - b).slice(0, AGENDA_MAX_ITEMS);

  const version = input.digest(JSON.stringify({ items, nextWakes })).slice(0, 32);
  return { version, window: { from, to }, items, nextWakes };
}
