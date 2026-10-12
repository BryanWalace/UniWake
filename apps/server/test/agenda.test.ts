/**
 * M16-T05: the shutdown agenda a lab PC receives (FR-303.1, FR-306.2, ADR-045, owner Q-1/Q-4).
 * São Paulo has no DST since 2019, so local = UTC−3 throughout.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { agendaSchema } from '@uniwake/shared';
import {
  AGENDA_LOOKBACK_MS,
  buildAgenda,
  type AgendaDevice,
  type AgendaInput,
  type AgendaSchedule,
} from '../src/domain/agenda';
import { scheduleRunUuid } from '../src/db/sync/uuid';

/** Local São Paulo time on day `d` of October 2026 (the 12th is a Monday). */
const sp = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h + 3, m);
const dayOf = (at: number) => new Date(at - 3 * 3_600_000).getUTCDate();
const MON_NOON = sp(12, 12);

const ROOM = 1;
const PROF_TAG = { id: 7, uuid: 'aaaaaaaa-0000-4000-8000-000000000007' };
const device = (over: Partial<AgendaDevice> = {}): AgendaDevice => ({
  id: 10,
  roomId: ROOM,
  tagIds: [],
  tagUuids: [],
  enabled: true,
  neverScheduledShutdown: false,
  ...over,
});
let seq = 0;
const schedule = (over: Partial<AgendaSchedule> = {}): AgendaSchedule => ({
  id: ++seq,
  uuid: `bbbbbbbb-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  enabled: true,
  action: 'shutdown',
  weekdays: 31, // Mon–Fri
  timeLocal: '22:40',
  timezone: 'America/Sao_Paulo',
  target: { type: 'rooms', roomIds: [ROOM], includeNoRoom: false },
  warningMinutes: 5,
  allowPostpone: true,
  postponeMax: 2,
  postponeMinutes: 15,
  excludeTags: [],
  ...over,
});
const input = (over: Partial<AgendaInput> = {}): AgendaInput => ({
  device: device(),
  schedules: [schedule()],
  exceptions: [],
  pause: null,
  now: MON_NOON,
  occurrenceId: scheduleRunUuid,
  digest: (t) => createHash('sha256').update(t).digest('hex'),
  ...over,
});
const days = (a: ReturnType<typeof buildAgenda>) => a.items.map((i) => dayOf(i.at));

describe('shutdown agenda (FR-303.1)', () => {
  it('AC-303-01: holidays and pauses simply produce no item; 14 days of concrete instants', () => {
    const holiday = {
      scheduleId: null,
      startDate: '2026-10-14',
      endDate: '2026-10-14',
      description: 'Feriado',
    };
    const a = buildAgenda(input({ exceptions: [holiday] }));
    expect(days(a)).toEqual([12, 13, 15, 16, 19, 20, 21, 22, 23]);
    expect(a.items.every((i) => (i.at - sp(12, 22, 40)) % 86_400_000 === 0)).toBe(true);
    expect(a.window).toEqual({
      from: MON_NOON - AGENDA_LOOKBACK_MS,
      to: MON_NOON + 14 * 86_400_000,
    });
    expect(agendaSchema.safeParse(a).success).toBe(true);

    const paused = buildAgenda(
      input({ exceptions: [holiday], pause: { since: MON_NOON - 1000, resumeAt: sp(16, 0) } }),
    );
    expect(days(paused)).toEqual([16, 19, 20, 21, 22, 23]);
    const manualPause = buildAgenda(input({ pause: { since: MON_NOON - 1000, resumeAt: null } }));
    expect(manualPause.items).toEqual([]);
  });

  it('AC-306-03: excluded tags and "Nunca desligar por agendamento" get no items; others do', () => {
    const s = schedule({ excludeTags: [PROF_TAG.uuid] });
    const prof = buildAgenda(
      input({
        schedules: [s],
        device: device({ tagIds: [PROF_TAG.id], tagUuids: [PROF_TAG.uuid] }),
      }),
    );
    const flagged = buildAgenda(
      input({ schedules: [s], device: device({ neverScheduledShutdown: true }) }),
    );
    const plain = buildAgenda(input({ schedules: [s] }));
    expect(prof.items).toEqual([]);
    expect(flagged.items).toEqual([]);
    expect(plain.items.length).toBeGreaterThan(0);
  });

  it('carries the schedule policy and the deterministic occurrence id of every team hub', () => {
    const s = schedule({
      warningMinutes: 10,
      allowPostpone: false,
      postponeMax: 0,
      postponeMinutes: 5,
    });
    const [first] = buildAgenda(input({ schedules: [s] })).items;
    expect(first).toEqual({
      occurrence: scheduleRunUuid(s.uuid, sp(12, 22, 40)),
      at: sp(12, 22, 40),
      action: 'shutdown',
      warningMinutes: 10,
      allowPostpone: false,
      postponeMax: 0,
      postponeMinutes: 5,
    });
  });

  it('only schedules that target the PC count; disabled schedules and PCs get nothing', () => {
    const otherRoom = schedule({ target: { type: 'rooms', roomIds: [2], includeNoRoom: false } });
    const byTag = schedule({ target: { type: 'tags', tagIds: [PROF_TAG.id] }, timeLocal: '23:00' });
    const byDevice = schedule({ target: { type: 'devices', deviceIds: [10] }, timeLocal: '23:30' });
    const all = schedule({ target: { type: 'all' }, timeLocal: '23:45', enabled: false });
    const a = buildAgenda(
      input({
        schedules: [otherRoom, byTag, byDevice, all],
        device: device({ tagIds: [PROF_TAG.id], tagUuids: [PROF_TAG.uuid] }),
      }),
    );
    const times = new Set(a.items.map((i) => new Date(i.at).toISOString().slice(11, 16)));
    expect([...times].sort()).toEqual(['02:00', '02:30']); // 23:00 and 23:30 local
    expect(buildAgenda(input({ device: device({ enabled: false }) })).items).toEqual([]);
  });

  it("lists the PC's wake times for the late-wake rule; wake schedules give no shutdown item", () => {
    const wake = schedule({
      action: 'wake',
      timeLocal: '17:40',
      warningMinutes: null,
      allowPostpone: null,
      postponeMax: null,
      postponeMinutes: null,
    });
    const a = buildAgenda(input({ schedules: [schedule(), wake] }));
    expect(a.items.every((i) => i.at % 60_000 === 0 && new Date(i.at).getUTCHours() === 1)).toBe(
      true,
    );
    expect(a.nextWakes[0]).toBe(sp(12, 17, 40));
    // The window ends on Monday 26 at noon, before that day's 17:40.
    expect(a.nextWakes.map(dayOf)).toEqual([12, 13, 14, 15, 16, 19, 20, 21, 22, 23]);
  });

  it('keeps items of the last 6 hours (a PC in a warning or late wake still sees its item)', () => {
    const at2240 = sp(12, 22, 40);
    expect(buildAgenda(input({ now: at2240 + 2 * 3_600_000 })).items[0]!.at).toBe(at2240);
    expect(buildAgenda(input({ now: at2240 + 7 * 3_600_000 })).items[0]!.at).toBe(sp(13, 22, 40));
  });

  it('two schedules at the same minute shut the PC down once, the same choice on every hub', () => {
    const a = schedule();
    const b = schedule();
    const items = buildAgenda(input({ schedules: [b, a] })).items;
    expect(new Set(items.map((i) => i.at)).size).toBe(items.length);
    const first = items[0]!;
    const expected = [
      scheduleRunUuid(a.uuid, first.at),
      scheduleRunUuid(b.uuid, first.at),
    ].sort()[0];
    expect(first.occurrence).toBe(expected);
    expect(buildAgenda(input({ schedules: [a, b] })).items).toEqual(items);
  });

  it('the version depends on the items only: the same data give the same version a minute later', () => {
    const s = schedule();
    const now = buildAgenda(input({ schedules: [s] }));
    const later = buildAgenda(input({ schedules: [s], now: MON_NOON + 60_000 }));
    expect(later.version).toBe(now.version);
    expect(later.window.to).toBe(now.window.to + 60_000);
    const edited = buildAgenda(input({ schedules: [schedule({ timeLocal: '22:50' })] }));
    expect(edited.version).not.toBe(now.version);
    expect(now.version).toMatch(/^[0-9a-f]{32}$/);
  });

  it('caps the agenda at 200 items and shrinks the window to the last one instead of dropping silently', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      schedule({ weekdays: 127, timeLocal: `20:${String(i).padStart(2, '0')}` }),
    );
    const a = buildAgenda(input({ schedules: many }));
    expect(a.items).toHaveLength(200);
    expect(a.window.to).toBe(a.items[199]!.at);
    expect(agendaSchema.safeParse(a).success).toBe(true);
  });
});
