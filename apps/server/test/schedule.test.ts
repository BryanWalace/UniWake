import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALL_WEEKDAYS,
  decideRuns,
  exceptionFor,
  type ExceptionRange,
  nextOccurrences,
  occurrenceAt,
  occurrencesBetween,
  ON_TIME_MS,
  weekdayBit,
  WEEKDAYS_MON_FRI,
} from '../src/domain/schedule';
import { localDay } from '../src/domain/tz';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const LIS = 'Europe/Lisbon';
const MIN = 60_000;
const H = 60 * MIN;

/** Local wall-clock "YYYY-MM-DD HH:mm" of an instant (for readable assertions). */
function wall(at: number, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

describe('weekdays', () => {
  it('maps local days to Mon=1 … Sun=64', () => {
    expect(weekdayBit('2026-10-05')).toBe(1); // Monday
    expect(weekdayBit('2026-10-09')).toBe(16); // Friday
    expect(weekdayBit('2026-10-11')).toBe(64); // Sunday
  });
});

describe('next runs (FR-005.1)', () => {
  const rule = { weekdays: WEEKDAYS_MON_FRI, timeLocal: '06:50', timezone: SP };

  it('AC-005-01: Mon–Fri 06:50 São Paulo → the next 5 weekdays at 06:50, skipping exceptions', () => {
    const friday = Date.UTC(2026, 10, 13, 12, 0); // Fri 13 Nov 2026 09:00 local
    const holidays: ExceptionRange[] = [
      {
        scheduleId: null,
        startDate: '2026-11-20',
        endDate: '2026-11-20',
        description: 'Consciência Negra',
      },
    ];
    const runs = nextOccurrences(rule, friday, 5, (d) => exceptionFor(d, holidays, 1) !== null);
    expect(runs.map((r) => wall(r.at, SP))).toEqual([
      '2026-11-16 06:50',
      '2026-11-17 06:50',
      '2026-11-18 06:50',
      '2026-11-19 06:50',
      '2026-11-23 06:50',
    ]);
    expect(runs[0]!.at).toBe(Date.UTC(2026, 10, 16, 9, 50)); // UTC−3
  });

  it('the run at exactly "after" is not "next"; one second before it is', () => {
    const at = occurrenceAt('2026-11-16', '06:50', SP);
    expect(nextOccurrences(rule, at, 1)[0]!.day).toBe('2026-11-17');
    expect(nextOccurrences(rule, at - 1000, 1)[0]!.day).toBe('2026-11-16');
  });

  it('handles midnight, month end, year end and leap days', () => {
    const midnight = { weekdays: ALL_WEEKDAYS, timeLocal: '00:00', timezone: SP };
    const from = Date.UTC(2028, 1, 28, 12); // 28 Feb 2028 (leap year)
    expect(nextOccurrences(midnight, from, 3).map((r) => r.day)).toEqual([
      '2028-02-29',
      '2028-03-01',
      '2028-03-02',
    ]);
    const late = { weekdays: ALL_WEEKDAYS, timeLocal: '23:59', timezone: SP };
    expect(nextOccurrences(late, Date.UTC(2026, 11, 31, 12), 2).map((r) => wall(r.at, SP))).toEqual(
      ['2026-12-31 23:59', '2027-01-01 23:59'],
    );
  });

  it('a schedule with no weekdays never runs; exceptions spanning years still terminate', () => {
    expect(nextOccurrences({ ...rule, weekdays: 0 }, 0, 5)).toEqual([]);
    expect(nextOccurrences(rule, Date.UTC(2026, 0, 1), 5, () => true)).toEqual([]);
  });

  it('property: next runs are increasing, on allowed weekdays, at the local time, after "after"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 127 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.constantFrom(SP, NY, LIS, 'UTC'),
        fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2030, 0, 1) }),
        (weekdays, h, m, tz, after) => {
          const timeLocal = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          const runs = nextOccurrences({ weekdays, timeLocal, timezone: tz }, after, 5);
          expect(runs).toHaveLength(5);
          let prev = after;
          for (const r of runs) {
            expect(r.at).toBeGreaterThan(prev);
            expect(weekdays & weekdayBit(r.day)).not.toBe(0);
            expect(localDay(r.at, tz)).toBe(r.day);
            prev = r.at;
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('DST (FR-005.5, ADR-008)', () => {
  it('AC-005-06: New York 02:30 on the spring-forward day fires at 03:00 local', () => {
    const at = occurrenceAt('2026-03-08', '02:30', NY);
    expect(wall(at, NY)).toBe('2026-03-08 03:00');
    expect(at).toBe(Date.UTC(2026, 2, 8, 7, 0));
  });

  it('AC-005-06: New York 01:30 on the fall-back day fires once, at the first 01:30 (EDT)', () => {
    const rule = { weekdays: ALL_WEEKDAYS, timeLocal: '01:30', timezone: NY };
    const runs = occurrencesBetween(rule, Date.UTC(2026, 10, 1, 0), Date.UTC(2026, 10, 1, 12));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.at).toBe(Date.UTC(2026, 10, 1, 5, 30)); // 01:30 EDT, not 01:30 EST (06:30Z)
  });

  it('matrix: Lisbon and New York around both transitions, and ordinary days', () => {
    const cases: [string, string, string, string][] = [
      // zone, day, local time, expected local wall time
      [LIS, '2026-03-29', '01:30', '2026-03-29 02:00'], // 01:00→02:00 gap
      [LIS, '2026-03-29', '02:30', '2026-03-29 02:30'],
      [LIS, '2026-10-25', '01:30', '2026-10-25 01:30'], // ambiguous, first one
      [NY, '2026-03-08', '02:00', '2026-03-08 03:00'],
      [NY, '2026-03-08', '02:59', '2026-03-08 03:00'],
      [NY, '2026-03-08', '03:00', '2026-03-08 03:00'],
      [NY, '2026-11-01', '00:59', '2026-11-01 00:59'],
      [NY, '2026-11-01', '02:00', '2026-11-01 02:00'],
      [SP, '2026-10-18', '00:00', '2026-10-18 00:00'], // Brazil has no DST since 2019
    ];
    for (const [tz, day, time, expected] of cases) {
      expect(wall(occurrenceAt(day, time, tz), tz), `${tz} ${day} ${time}`).toBe(expected);
    }
    // Lisbon fall back: 01:30 WEST (00:30Z) is the first occurrence, not 01:30 WET (01:30Z).
    expect(occurrenceAt('2026-10-25', '01:30', LIS)).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it('Brazil 2018 (historic DST): the skipped midnight runs at 01:00', () => {
    expect(wall(occurrenceAt('2018-11-04', '00:00', SP), SP)).toBe('2018-11-04 01:00');
  });
});

describe('run decisions (FR-005.2/.4/.6)', () => {
  const rule = { weekdays: WEEKDAYS_MON_FRI, timeLocal: '06:50', timezone: SP };
  const opts = (over: Partial<Parameters<typeof decideRuns>[2]> = {}) => ({
    graceMs: 15 * MIN,
    exception: () => null,
    pausedAt: () => false,
    ...over,
  });
  const monday = occurrenceAt('2026-10-05', '06:50', SP);

  it('on time within 2 minutes is "executado"', () => {
    const [d] = decideRuns([{ day: '2026-10-05', at: monday }], monday + ON_TIME_MS, opts());
    expect(d).toMatchObject({ action: 'run', status: 'executado' });
  });

  it('AC-005-05: start at 06:58 → "atrasado (8 min)"; start at 07:20 → "perdido", no wake', () => {
    const due = [{ day: '2026-10-05', at: monday }];
    expect(decideRuns(due, monday + 8 * MIN, opts())[0]).toMatchObject({
      action: 'run',
      status: 'atrasado',
      delayMs: 8 * MIN,
    });
    expect(decideRuns(due, monday + 30 * MIN, opts())[0]).toMatchObject({
      action: 'log',
      status: 'perdido',
    });
  });

  it('AC-005-08: down Fri 18:00 → Mon 06:55: Monday runs late, Saturday 08:00 is lost', () => {
    const fri = Date.UTC(2026, 9, 9, 21, 0); // Fri 18:00 local
    const mon = Date.UTC(2026, 9, 12, 9, 55); // Mon 06:55 local
    const weekday = occurrencesBetween(rule, fri, mon);
    const saturday = occurrencesBetween(
      { weekdays: 32, timeLocal: '08:00', timezone: SP },
      fri,
      mon,
    );
    expect(weekday.map((o) => o.day)).toEqual(['2026-10-12']);
    expect(decideRuns(weekday, mon, opts())[0]).toMatchObject({
      action: 'run',
      status: 'atrasado',
      delayMs: 5 * MIN,
    });
    expect(decideRuns(saturday, mon, opts())[0]).toMatchObject({
      action: 'log',
      status: 'perdido',
    });
  });

  it('several missed occurrences of one schedule: only the most recent may run', () => {
    const every = { weekdays: ALL_WEEKDAYS, timeLocal: '06:50', timezone: SP };
    const due = occurrencesBetween(every, monday - 3 * 24 * H, monday);
    const decisions = decideRuns(due, monday + 5 * MIN, opts());
    expect(decisions.map((d) => d.status)).toEqual(['perdido', 'perdido', 'atrasado']); // window start is exclusive
  });

  it('AC-005-02: an exception day is "pulado (feriado)" with its description; pauses are "pulado (pausa)"', () => {
    const holidays: ExceptionRange[] = [
      { scheduleId: 7, startDate: '2026-10-05', endDate: '2026-10-05', description: 'Recesso' },
    ];
    const due = [{ day: '2026-10-05', at: monday }];
    expect(
      decideRuns(due, monday, opts({ exception: (d) => exceptionFor(d, holidays, 7) }))[0],
    ).toMatchObject({ status: 'pulado_feriado', detail: 'Recesso' });
    expect(exceptionFor('2026-10-05', holidays, 8)).toBeNull(); // another schedule's exception
    expect(decideRuns(due, monday, opts({ pausedAt: () => true }))[0]).toMatchObject({
      status: 'pulado_pausa',
    });
  });
});
