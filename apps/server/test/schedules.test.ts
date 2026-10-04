import { afterEach, describe, expect, it } from 'vitest';
import type { NextRun, Schedule } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const call = async <T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => {
    const r = await h.inject({ method, url, cookie, ...(payload ? { payload } : {}) });
    return { status: r.statusCode, body: (r.body ? r.json() : null) as T };
  };
  const room = h.services.rooms.create({ name: 'Lab 1' }, ACTOR).id;
  const mac = (i: number) =>
    `00:CC:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`;
  for (let i = 0; i < 3; i++)
    h.services.devices.create({ name: `PC-${i}`, mac: mac(i), roomId: room }, ACTOR);
  return { h, call, room, mac };
}

const MON_FRI = 31;

describe('schedules API (FR-005.1)', () => {
  it('creates a Mon–Fri 06:50 room schedule in the hub time zone and lists its next runs (AC-005-01)', async () => {
    const { call, room } = await setup();
    const created = await call<Schedule>('POST', '/api/schedules', {
      name: 'Abertura manhã',
      weekdays: MON_FRI,
      timeLocal: '06:50',
      target: { type: 'rooms', roomIds: [room] },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Abertura manhã',
      enabled: true,
      timezone: 'America/Sao_Paulo',
      targetLabel: 'sala Lab 1',
      targetCount: 3,
      emptyTarget: false,
      confirmedCount: null,
      nextRun: Date.UTC(2026, 9, 5, 9, 50), // T0 is Mon 06:00 local → today 06:50
    });
    const runs = await call<NextRun[]>('GET', `/api/schedules/${created.body.id}/next-runs`);
    expect(runs.body.map((r) => r.day)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
    const list = await call<Schedule[]>('GET', '/api/schedules');
    expect(list.body.map((s) => s.id)).toEqual([created.body.id]);
  });

  it('rejects bad input with field errors and unknown targets with TARGET_NOT_FOUND', async () => {
    const { call, room } = await setup();
    const base = {
      name: 'X',
      weekdays: MON_FRI,
      timeLocal: '06:50',
      target: { type: 'rooms', roomIds: [room] },
    };
    for (const bad of [
      { ...base, weekdays: 0 },
      { ...base, weekdays: 128 },
      { ...base, timeLocal: '25:00' },
      { ...base, timeLocal: '6:5' },
      { ...base, timezone: 'Marte/Olimpo' },
      { ...base, name: '' },
      { ...base, target: { type: 'devices', deviceIds: [] } },
    ]) {
      expect((await call('POST', '/api/schedules', bad)).status, JSON.stringify(bad)).toBe(422);
    }
    const missing = await call<{ code: string }>('POST', '/api/schedules', {
      ...base,
      target: { type: 'rooms', roomIds: [999] },
    });
    expect(missing).toMatchObject({ status: 422, body: { code: 'TARGET_NOT_FOUND' } });
  });

  it('SR-10: a large target must be confirmed once, at save time, with the exact count', async () => {
    const { h, call, mac } = await setup();
    const big = h.services.rooms.create({ name: 'Auditório' }, ACTOR).id;
    for (let i = 10; i < 55; i++)
      h.services.devices.create({ name: `A-${i}`, mac: mac(i), roomId: big }, ACTOR);
    const body = {
      name: 'Auditório',
      weekdays: MON_FRI,
      timeLocal: '07:00',
      target: { type: 'rooms', roomIds: [big] },
    };
    const first = await call<{ code: string; details: { count: number } }>(
      'POST',
      '/api/schedules',
      body,
    );
    expect(first).toMatchObject({
      status: 409,
      body: { code: 'CONFIRMATION_REQUIRED', details: { count: 45 } },
    });
    expect((await call('POST', '/api/schedules', { ...body, confirm: { count: 44 } })).status).toBe(
      409,
    );
    const ok = await call<Schedule>('POST', '/api/schedules', { ...body, confirm: { count: 45 } });
    expect(ok).toMatchObject({ status: 201, body: { confirmedCount: 45, targetCount: 45 } });
    // Editing anything but the target needs no new confirmation.
    expect(
      (await call('PATCH', `/api/schedules/${ok.body.id}`, { timeLocal: '07:10' })).status,
    ).toBe(200);
    // Changing the target to "all" (48 machines) asks again.
    expect(
      (await call('PATCH', `/api/schedules/${ok.body.id}`, { target: { type: 'all' } })).status,
    ).toBe(409);
  });

  it('AC-005-11: a schedule on a room that gets deleted shows "alvo vazio"', async () => {
    const { h, call, room } = await setup();
    const s = await call<Schedule>('POST', '/api/schedules', {
      name: 'Lab 1',
      weekdays: MON_FRI,
      timeLocal: '06:50',
      target: { type: 'rooms', roomIds: [room] },
    });
    h.services.rooms.delete(room, true, ACTOR);
    const after = await call<Schedule>('GET', `/api/schedules/${s.body.id}`);
    expect(after.body).toMatchObject({
      emptyTarget: true,
      targetCount: 0,
      target: { type: 'rooms', roomIds: [], includeNoRoom: false },
    });
  });

  it('updates, disables (no next run), deletes and audits', async () => {
    const { h, call, room } = await setup();
    const s = await call<Schedule>('POST', '/api/schedules', {
      name: 'Tarde',
      weekdays: MON_FRI,
      timeLocal: '13:00',
      target: { type: 'rooms', roomIds: [room], includeNoRoom: true },
      onlyOffline: true,
      stagger: { batchSize: 5, batchDelaySeconds: 10 },
    });
    expect(s.body).toMatchObject({
      onlyOffline: true,
      stagger: { batchSize: 5, batchDelaySeconds: 10 },
    });
    const off = await call<Schedule>('PATCH', `/api/schedules/${s.body.id}`, {
      enabled: false,
      stagger: null,
    });
    expect(off.body).toMatchObject({ enabled: false, nextRun: null, stagger: null });
    expect((await call('DELETE', `/api/schedules/${s.body.id}`)).status).toBe(204);
    expect((await call('GET', `/api/schedules/${s.body.id}`)).status).toBe(404);
    expect((await call('DELETE', `/api/schedules/${s.body.id}`)).status).toBe(404);
    const actions = h.services.db
      .all<{ action: string }>(
        "SELECT action FROM audit_log WHERE action LIKE 'schedule.%' ORDER BY id",
      )
      .map((r) => r.action);
    expect(actions).toEqual(['schedule.create', 'schedule.update', 'schedule.delete']);
    expect(T0).toBeGreaterThan(0);
  });

  it('requires a session', async () => {
    const { h } = await setup();
    expect((await h.inject({ url: '/api/schedules' })).statusCode).toBe(401);
  });
});

describe('schedule exceptions (FR-005.2)', () => {
  const sched = (room: number, name = 'Manhã') => ({
    name,
    weekdays: MON_FRI,
    timeLocal: '06:50',
    target: { type: 'rooms', roomIds: [room] },
  });

  it('AC-005-02: a global holiday is skipped by every schedule; a schedule exception only by its own', async () => {
    const { call, room } = await setup(); // Mon 5 Oct 2026, 06:00 local
    const a = (await call<Schedule>('POST', '/api/schedules', sched(room, 'A'))).body;
    const b = (await call<Schedule>('POST', '/api/schedules', sched(room, 'B'))).body;
    const holiday = await call<{ id: number }>('POST', '/api/schedule-exceptions', {
      startDate: '2026-10-07',
      description: 'Feriado municipal',
    });
    expect(holiday).toMatchObject({
      status: 201,
      body: { scheduleId: null, endDate: '2026-10-07' },
    });
    await call('POST', '/api/schedule-exceptions', {
      scheduleId: b.id,
      startDate: '2026-10-08',
      endDate: '2026-10-09',
      description: 'Prova no Lab',
    });
    const days = async (id: number) =>
      (await call<NextRun[]>('GET', `/api/schedules/${id}/next-runs`)).body.map((r) => r.day);
    expect(await days(a.id)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-08',
      '2026-10-09',
      '2026-10-12',
    ]);
    expect(await days(b.id)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
    const list = await call<{ description: string }[]>('GET', '/api/schedule-exceptions');
    expect(list.body.map((e) => e.description)).toEqual(['Feriado municipal', 'Prova no Lab']);
  });

  it('validates dates, ranges and the schedule; deleting works once and is audited', async () => {
    const { h, call, room } = await setup();
    for (const bad of [
      { startDate: '2026-02-30', description: 'x' },
      { startDate: '20-11-2026', description: 'x' },
      { startDate: '2026-11-20', endDate: '2026-11-19', description: 'x' },
      { startDate: '2026-01-01', endDate: '2027-06-01', description: 'x' },
      { startDate: '2026-11-20', description: '' },
      { startDate: '2026-11-20', description: 'x'.repeat(101) },
    ]) {
      expect(
        (await call('POST', '/api/schedule-exceptions', bad)).status,
        JSON.stringify(bad),
      ).toBe(422);
    }
    expect(
      (
        await call('POST', '/api/schedule-exceptions', {
          scheduleId: 999,
          startDate: '2026-11-20',
          description: 'x',
        })
      ).status,
    ).toBe(404);
    const s = (await call<Schedule>('POST', '/api/schedules', sched(room))).body;
    const e = (
      await call<{ id: number }>('POST', '/api/schedule-exceptions', {
        scheduleId: s.id,
        startDate: '2026-12-21',
        endDate: '2027-01-31',
        description: 'Férias',
      })
    ).body;
    expect((await call('DELETE', `/api/schedule-exceptions/${e.id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/schedule-exceptions/${e.id}`)).status).toBe(404);
    // A schedule's own exceptions go with it.
    await call('POST', '/api/schedule-exceptions', {
      scheduleId: s.id,
      startDate: '2026-12-24',
      description: 'Natal',
    });
    await call('DELETE', `/api/schedules/${s.id}`);
    expect((await call<unknown[]>('GET', '/api/schedule-exceptions')).body).toEqual([]);
    const actions = h.services.db
      .all<{ action: string }>(
        "SELECT action FROM audit_log WHERE action LIKE 'schedule.exception.%' ORDER BY id",
      )
      .map((r) => r.action);
    expect(actions).toEqual([
      'schedule.exception.create',
      'schedule.exception.delete',
      'schedule.exception.create',
    ]);
  });
});
