/**
 * Schedule arithmetic (FR-005, ADR-008). Pure. Times are UTC epoch ms; days are local
 * `YYYY-MM-DD` in the schedule's IANA zone; weekdays are a bitmask Mon=1 … Sun=64 (plan §5).
 *
 * DST: a local time that does not exist (spring forward) runs at the first valid instant after it,
 * i.e. when the clocks jump; one that exists twice (fall back) runs once, at its first occurrence.
 */
import { addDays, localDay, tzOffsetMs } from './tz';

export const WEEKDAY_BITS = [1, 2, 4, 8, 16, 32, 64] as const; // Mon … Sun
export const ALL_WEEKDAYS = 127;
export const WEEKDAYS_MON_FRI = 31;

export interface ScheduleRule {
  weekdays: number;
  /** `HH:mm`, 24 h. */
  timeLocal: string;
  timezone: string;
}

export interface Occurrence {
  day: string;
  at: number;
}

export interface ExceptionRange {
  /** null = applies to every schedule. */
  scheduleId: number | null;
  startDate: string;
  endDate: string;
  description: string;
}

/** Bit of the weekday of a local day (Mon=1 … Sun=64). */
export function weekdayBit(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return WEEKDAY_BITS[(js + 6) % 7]!;
}

const MINUTE = 60_000;

/** The instant a local wall-clock time on `day` happens in `tz`, with the DST rules above. */
export function occurrenceAt(day: string, timeLocal: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [h, mi] = timeLocal.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, mi);
  // The zone's offsets well before and after this wall time cover any transition on this day.
  const before = tzOffsetMs(wall - 26 * 3_600_000, tz);
  const after = tzOffsetMs(wall + 26 * 3_600_000, tz);
  const valid = [wall - before, wall - after].filter((t) => t + tzOffsetMs(t, tz) === wall);
  if (valid.length > 0) return Math.min(...valid); // ambiguous → first occurrence
  // Non-existent: the clocks jumped over it. Find the jump: the first instant on the new offset.
  let lo = Math.min(wall - before, wall - after);
  let hi = Math.max(wall - before, wall - after);
  const offsetAtLo = tzOffsetMs(lo, tz);
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
    if (tzOffsetMs(mid, tz) === offsetAtLo) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Occurrences with `fromExclusive < at <= toInclusive` (exceptions included; see `exceptionFor`). */
export function occurrencesBetween(
  rule: ScheduleRule,
  fromExclusive: number,
  toInclusive: number,
): Occurrence[] {
  const out: Occurrence[] = [];
  if (toInclusive <= fromExclusive || rule.weekdays === 0) return out;
  // One day of slack each side: an occurrence's day and its UTC instant can differ by a day.
  let day = addDays(localDay(fromExclusive, rule.timezone), -1);
  const last = addDays(localDay(toInclusive, rule.timezone), 1);
  for (; day <= last; day = addDays(day, 1)) {
    if ((rule.weekdays & weekdayBit(day)) === 0) continue;
    const at = occurrenceAt(day, rule.timeLocal, rule.timezone);
    if (at > fromExclusive && at <= toInclusive) out.push({ day, at });
  }
  return out;
}

/** The exception covering `day` for that schedule (global or its own), if any. */
export function exceptionFor(
  day: string,
  exceptions: readonly ExceptionRange[],
  scheduleId: number,
): ExceptionRange | null {
  return (
    exceptions.find(
      (e) =>
        (e.scheduleId === null || e.scheduleId === scheduleId) &&
        e.startDate <= day &&
        day <= e.endDate,
    ) ?? null
  );
}

/** The next `count` runs after `after`, skipping exception days (AC-005-01). */
export function nextOccurrences(
  rule: ScheduleRule,
  after: number,
  count: number,
  isException: (day: string) => boolean = () => false,
): Occurrence[] {
  const out: Occurrence[] = [];
  if (rule.weekdays === 0) return out;
  let from = after;
  // Two years is plenty even with long exception ranges; the loop never spins forever.
  for (let guard = 0; out.length < count && guard < 105; guard++) {
    const to = from + 7 * 86_400_000;
    for (const o of occurrencesBetween(rule, from, to)) {
      if (!isException(o.day)) out.push(o);
      if (out.length === count) break;
    }
    from = to;
  }
  return out;
}

export type RunStatus =
  'executado' | 'atrasado' | 'pulado_feriado' | 'pulado_pausa' | 'perdido' | 'falhou';

export type RunDecision =
  | { occurrence: Occurrence; action: 'run'; status: 'executado' | 'atrasado'; delayMs: number }
  | {
      occurrence: Occurrence;
      action: 'log';
      status: 'pulado_feriado' | 'pulado_pausa' | 'perdido';
      detail: string | null;
    };

/** A run this late still counts as on time (the tick is at most 30 s). */
export const ON_TIME_MS = 2 * MINUTE;

/**
 * What to do with one schedule's due occurrences (FR-005.2/.4/.6). Only the most recent one may
 * still run, and only within the grace window; older ones are `perdido`. Exception days are
 * `pulado (feriado)` and runs during a pause `pulado (pausa)`.
 */
export function decideRuns(
  due: readonly Occurrence[],
  now: number,
  opts: {
    graceMs: number;
    exception: (day: string) => ExceptionRange | null;
    /** Pause in force at that instant (start inclusive, resume exclusive). */
    pausedAt: (at: number) => boolean;
  },
): RunDecision[] {
  const sorted = [...due].sort((a, b) => a.at - b.at);
  return sorted.map((occurrence, i) => {
    const holiday = opts.exception(occurrence.day);
    if (holiday) {
      return { occurrence, action: 'log', status: 'pulado_feriado', detail: holiday.description };
    }
    if (opts.pausedAt(occurrence.at)) {
      return { occurrence, action: 'log', status: 'pulado_pausa', detail: null };
    }
    const delayMs = Math.max(0, now - occurrence.at);
    const latest = i === sorted.length - 1;
    if (!latest || delayMs > opts.graceMs) {
      return { occurrence, action: 'log', status: 'perdido', detail: null };
    }
    return {
      occurrence,
      action: 'run',
      status: delayMs <= ON_TIME_MS ? 'executado' : 'atrasado',
      delayMs,
    };
  });
}
