import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardNotice, MorningResult } from '@uniwake/shared';
import { SqliteSchedulerRepo } from '../src/db/repositories/scheduler-repo';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const sp = (day: number, h: number, m = 0, s = 0) => Date.UTC(2026, 9, day, h + 3, m, s);

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) {
    h.services.scheduler.stop();
    for (let i = 0; i < 400 && h.services.runner.activeCount > 0; i++)
      await h.clock.advanceAsync(5_000);
    await h.close();
  }
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  await h.as('operator');
  const s = h.services;
  const lab1 = s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
  const ips = ['10.0.3.11', '10.0.3.12', '10.0.3.13'];
  ips.forEach((ip, i) =>
    s.devices.create(
      { name: `LAB1-PC0${i + 1}`, mac: `00:EE:00:00:00:0${i}`, roomId: lab1, ip },
      ACTOR,
    ),
  );
  const schedule = (over: Record<string, unknown> = {}) =>
    s.schedules.create(
      {
        name: 'Abertura',
        weekdays: 31,
        timeLocal: '06:50',
        target: { type: 'rooms', roomIds: [lab1] },
        ...over,
      },
      ACTOR,
    ).id;
  const call = async (method: 'GET' | 'POST', url: string) =>
    h.inject({ method, url, cookie: await h.login('operator-user') });
  /** Runs the scheduler at 06:50:05 and lets the wake job finish its 5-minute verification. */
  const runMorning = async () => {
    h.clock.set(sp(5, 6, 49));
    s.scheduler.tick();
    h.clock.set(sp(5, 6, 50, 5));
    s.scheduler.tick();
    for (let i = 0; i < 400 && s.runner.activeCount > 0; i++) await h.clock.advanceAsync(5_000);
  };
  return { h, s, lab1, schedule, call, runMorning, ips };
}

describe('morning result (FR-013)', () => {
  it('AC-013-01: a scheduled run with 2 non-responders in Lab 1 is listed until "Ciente" (audited)', async () => {
    const { h, s, schedule, call, runMorning, ips } = await setup();
    schedule();
    h.ports.prober.setAlive(ips[0]!); // one wakes, two never answer
    const events: string[] = [];
    s.events.subscribe((e) => {
      if (e.type === 'notice') events.push(e.noticeType);
    });
    await runMorning();

    const list = (await call('GET', '/api/notices')).json<DashboardNotice[]>();
    expect(list).toHaveLength(1);
    const data = list[0]!.data as unknown as MorningResult;
    expect(list[0]!.type).toBe('morning_result');
    expect(data.day).toBe('2026-10-05');
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0]).toMatchObject({
      scheduleName: 'Abertura',
      status: 'executado',
      total: 3,
      woke: 1,
    });
    expect(data.runs[0]!.notWoken).toEqual([
      {
        roomId: expect.any(Number),
        roomName: 'Lab 1',
        devices: [
          expect.objectContaining({ name: 'LAB1-PC02', result: 'nao_respondeu' }),
          expect.objectContaining({ name: 'LAB1-PC03', result: 'nao_respondeu' }),
        ],
      },
    ]);
    expect(s.dashboard.dashboard().notices.map((n) => n.id)).toEqual([list[0]!.id]);
    expect(events).toContain('morning_result');

    expect((await call('POST', `/api/notices/${list[0]!.id}/ack`)).statusCode).toBe(204);
    expect((await call('GET', '/api/notices')).json()).toEqual([]);
    expect(s.dashboard.dashboard().notices).toEqual([]);
    expect((await call('POST', `/api/notices/${list[0]!.id}/ack`)).statusCode).toBe(204); // idempotent
    expect((await call('POST', '/api/notices/999/ack')).statusCode).toBe(404);
    const audits = s.db.all<{ action: string; actor_label: string }>(
      "SELECT action, actor_label FROM audit_log WHERE action = 'notice.ack'",
    );
    expect(audits).toEqual([{ action: 'notice.ack', actor_label: 'operator-user' }]);
  });

  it('a morning where every machine woke pins nothing', async () => {
    const { h, schedule, call, runMorning, ips } = await setup();
    schedule();
    for (const ip of ips) h.ports.prober.setAlive(ip);
    await runMorning();
    expect((await call('GET', '/api/notices')).json()).toEqual([]);
  });

  it('failed and lost runs of the same day join one card, in planned order', async () => {
    const { h, s, schedule, call } = await setup();
    h.clock.set(sp(5, 4, 0)); // schedules exist before their occurrences
    const empty = s.rooms.create({ name: 'Lab Vazio' }, ACTOR).id;
    schedule({ name: 'Vazio', timeLocal: '06:30', target: { type: 'rooms', roomIds: [empty] } });
    schedule({ name: 'Cedo', timeLocal: '05:00' });
    new SqliteSchedulerRepo(s.db).setLastTick(sp(5, 4, 50));
    h.clock.set(sp(5, 6, 31));
    s.scheduler.tick();
    const [notice] = (await call('GET', '/api/notices')).json<DashboardNotice[]>();
    const runs = (notice!.data as unknown as MorningResult).runs;
    expect(runs.map((r) => [r.scheduleName, r.status, r.detail])).toEqual([
      ['Cedo', 'perdido', null],
      ['Vazio', 'falhou', 'alvo vazio'],
    ]);
  });
});
