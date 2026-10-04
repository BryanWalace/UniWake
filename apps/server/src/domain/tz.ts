/**
 * Local-day arithmetic in an IANA time zone without a date library (Intl only). Pure.
 * Days are `YYYY-MM-DD` strings; a day may be 23 or 25 hours long across DST changes.
 */
const formats = new Map<string, Intl.DateTimeFormat>();

function format(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formats.set(tz, f);
  }
  return f;
}

function parts(epochMs: number, tz: string) {
  const p: Record<string, number> = {};
  for (const x of format(tz).formatToParts(epochMs)) {
    if (x.type !== 'literal') p[x.type] = Number(x.value);
  }
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

/** Offset of `tz` from UTC at that instant, in ms (e.g. −3 h for America/Sao_Paulo). */
export function tzOffsetMs(epochMs: number, tz: string): number {
  const p = parts(epochMs, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(epochMs / 1000) * 1000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function localDay(epochMs: number, tz: string): string {
  const p = parts(epochMs, tz);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** First instant of `day` in `tz`. When midnight does not exist (DST start), the first valid one. */
export function dayStart(day: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  let t = naive - tzOffsetMs(naive, tz);
  t = naive - tzOffsetMs(t, tz);
  // Skipped midnight: step forward to the first instant that belongs to `day`.
  for (let i = 0; i < 4 && localDay(t, tz) < day; i++) t += 30 * 60_000;
  // Ambiguous shift landing in `day` too late: step back while the previous instant is still `day`.
  while (localDay(t - 1, tz) === day) t -= 30 * 60_000;
  return t;
}

/** `[start, end)` of the local day. */
export function dayRange(day: string, tz: string): { start: number; end: number } {
  return { start: dayStart(day, tz), end: dayStart(addDays(day, 1), tz) };
}

/** Next instant at local `HH:mm` strictly after `after`. */
export function nextLocalTime(after: number, hhmm: string, tz: string): number {
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  let day = localDay(after, tz);
  for (let i = 0; i < 3; i++) {
    const t = dayStart(day, tz) + (h * 60 + mi) * 60_000;
    if (t > after) return t;
    day = addDays(day, 1);
  }
  return after + 24 * 3_600_000;
}
