/**
 * M17-T04 (FR-306, ADR-048): schedules with "Ação: Desligar" — stored with an explicit policy and
 * excluded tags, never executed by the hub's scheduler, delivered through the machines' agendas.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Schedule } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const sp = (day: number, h: number, m = 0, s = 0) => Date.UTC(2026, 9, day, h + 3, m, s);

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) {
    h.services.scheduler.stop();
    await h.close();
  }
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  h.clock.set(sp(12, 12)); // Monday noon
  const cookie = await h.as('operator');
  const s = h.services;
  const room = s.rooms.create({ name: 'Lab 3' }, ACTOR).id;
  const prof = s.tags.create({ name: 'professor' }, ACTOR).id;
  const pc = s.devices.create({ name: 'PC-01', mac: '00:AA:00:00:00:01', roomId: room }, ACTOR)
    .device.id;
  const teacher = s.devices.create(
    { name: 'PROF', mac: '00:AA:00:00:00:02', roomId: room, tagIds: [prof] },
    ACTOR,
  ).device.id;
  const call = async <T>(method: 'POST' | 'PATCH' | 'GET', url: string, payload?: object) => {
    const r = await h.inject({ method, url, cookie, payload });
    return { status: r.statusCode, body: r.json<T>() };
  };
  const target = { type: 'rooms', roomIds: [room], includeNoRoom: false };
  return { h, s, room, prof, pc, teacher, call, target };
}

describe('schedules with "Ação: Desligar" (FR-306)', () => {
  it('AC-306-01: a shutdown schedule never wakes anything; the agendas carry it and the hub pushes it (ADR-053)', async () => {
    const { h, s, prof, pc, teacher, call, target } = await setup();
    const created = await call<Schedule>('POST', '/api/schedules', {
      name: 'Desligar 22:40',
      weekdays: 31,
      timeLocal: '22:40',
      target,
      action: 'shutdown',
      power: { warningMinutes: 10 },
      excludeTagIds: [prof],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      action: 'shutdown',
      power: { warningMinutes: 10, allowPostpone: true, postponeMax: 2, postponeMinutes: 15 },
      excludeTagIds: [prof],
      onlyOffline: false,
      stagger: null,
    });

    h.clock.set(sp(12, 22, 39));
    s.scheduler.tick();
    h.clock.set(sp(12, 22, 40, 5));
    s.scheduler.tick();
    // D-M16-01 still holds: never a wake. v1.6: the occurrence was pushed at the warning's start and
    // recorded; these machines have no agent yet, so no order went out and the run says why.
    expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM wake_jobs')!.n).toBe(0);
    expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM power_orders')!.n).toBe(0);
    const runs = s.db.all<{ status: string; detail: string }>(
      'SELECT status, detail FROM schedule_runs',
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.detail).toMatch(/^desligar: ordem para 0 máquina\(s\), \d+ sem agente pronto/);

    h.clock.set(sp(12, 12));
    const agenda = s.agenda.forDevice(pc)!;
    expect(agenda.items[0]).toMatchObject({
      at: sp(12, 22, 40),
      warningMinutes: 10,
      postponeMax: 2,
    });
    expect(s.agenda.forDevice(teacher)!.items).toEqual([]); // excluded by tag (FR-306.2)
  });

  it('switching the action stores or clears the policy; partial edits keep the rest', async () => {
    const { s, call, target } = await setup();
    s.settings.update({ 'power.defaultWarningMinutes': 3 }, null);
    const wake = await call<Schedule>('POST', '/api/schedules', {
      name: 'Manhã',
      weekdays: 31,
      timeLocal: '06:50',
      target,
      onlyOffline: true,
      stagger: { batchSize: 5, batchDelaySeconds: 10 },
    });
    expect(wake.body).toMatchObject({
      action: 'wake',
      power: null,
      excludeTagIds: [],
      onlyOffline: true,
    });
    const off = await call<Schedule>('PATCH', `/api/schedules/${wake.body.id}`, {
      action: 'shutdown',
    });
    expect(off.body).toMatchObject({
      action: 'shutdown',
      power: { warningMinutes: 3, allowPostpone: true, postponeMax: 2, postponeMinutes: 15 },
      onlyOffline: false,
      stagger: null,
    });
    const edited = await call<Schedule>('PATCH', `/api/schedules/${wake.body.id}`, {
      power: { postponeMax: 0, allowPostpone: false },
    });
    expect(edited.body.power).toEqual({
      warningMinutes: 3,
      allowPostpone: false,
      postponeMax: 0,
      postponeMinutes: 15,
    });
    const back = await call<Schedule>('PATCH', `/api/schedules/${wake.body.id}`, {
      action: 'wake',
    });
    expect(back.body).toMatchObject({ action: 'wake', power: null, excludeTagIds: [] });
    expect(
      s.db.get('SELECT warning_minutes, allow_postpone, exclude_tags FROM schedules WHERE id = ?', [
        wake.body.id,
      ]),
    ).toEqual({ warning_minutes: null, allow_postpone: null, exclude_tags: '[]' });
  });

  it('refuses an excluded tag that does not exist and out-of-range policies', async () => {
    const { call, target } = await setup();
    const base = { name: 'X', weekdays: 31, timeLocal: '22:40', target, action: 'shutdown' };
    const code = async (body: object) =>
      (await call<{ code: string }>('POST', '/api/schedules', { ...base, ...body })).body.code;
    expect(await code({ excludeTagIds: [999] })).toBe('TARGET_NOT_FOUND');
    expect(await code({ power: { warningMinutes: 31 } })).toBe('VALIDATION_FAILED');
  });
});
