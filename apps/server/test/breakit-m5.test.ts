/** M5-D break-it pass (tasks.md checklist) for the scheduler. */
import { afterEach, describe, expect, it } from 'vitest';
import type { MorningResult } from '@uniwake/shared';
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
  const room = s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
  s.devices.create(
    { name: 'PC-1', mac: '00:FF:00:00:00:01', roomId: room, ip: '10.0.3.21' },
    ACTOR,
  );
  s.devices.create(
    { name: 'PC-2', mac: '00:FF:00:00:00:02', roomId: room, ip: '10.0.3.22' },
    ACTOR,
  );
  const schedule = (over: Record<string, unknown> = {}) =>
    s.schedules.create(
      {
        name: 'Manhã',
        weekdays: 31,
        timeLocal: '06:50',
        target: { type: 'rooms', roomIds: [room] },
        ...over,
      },
      ACTOR,
    ).id;
  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) =>
    h.inject({
      method,
      url,
      cookie: await h.login('operator-user'),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const runs = () =>
    s.db.all<{ status: string; detail: string | null; job_id: number | null; planned_at: number }>(
      'SELECT status, detail, job_id, planned_at FROM schedule_runs ORDER BY planned_at, id',
    );
  const repo = new SqliteSchedulerRepo(s.db);
  return { h, s, room, schedule, call, runs, repo };
}

describe('M5-D: malformed input on the scheduler endpoints', () => {
  it('rejects oversized and malformed bodies with 4xx, never 500', async () => {
    const { call, room } = await setup();
    const base = {
      name: 'X',
      weekdays: 31,
      timeLocal: '06:50',
      target: { type: 'rooms', roomIds: [room] },
    };
    const bad: [string, string, unknown][] = [
      ['POST', '/api/schedules', { ...base, name: 'x'.repeat(1000) }],
      ['POST', '/api/schedules', { ...base, weekdays: '31' }],
      ['POST', '/api/schedules', { ...base, timeLocal: '24:00' }],
      ['POST', '/api/schedules', { ...base, timezone: 'x'.repeat(500) }],
      [
        'POST',
        '/api/schedules',
        {
          ...base,
          target: { type: 'rooms', roomIds: Array.from({ length: 2001 }, (_, i) => i + 1) },
        },
      ],
      ['POST', '/api/schedules', { ...base, stagger: { batchSize: 0, batchDelaySeconds: 5 } }],
      ['POST', '/api/schedules', { ...base, confirm: { count: -1 } }],
      ['POST', '/api/schedules', 'not json'],
      ['PATCH', '/api/schedules/abc', { name: 'Y' }],
      [
        'POST',
        '/api/schedule-exceptions',
        { startDate: '2026-11-20', description: 'x'.repeat(5000) },
      ],
      ['POST', '/api/scheduler/pause', { reason: 'x'.repeat(5000) }],
      ['POST', '/api/scheduler/pause', { reason: 'ok', resumeAt: 'amanhã' }],
      ['GET', '/api/schedule-runs?page=0', undefined],
      ['GET', '/api/schedule-runs?pageSize=1000', undefined],
      ['GET', '/api/schedules/1/next-runs?count=500', undefined],
    ];
    for (const [method, url, body] of bad) {
      const r = await call(method as 'POST', url, body);
      expect(r.statusCode, `${method} ${url}`).toBeGreaterThanOrEqual(400);
      expect(r.statusCode, `${method} ${url}`).toBeLessThan(500);
    }
    expect((await call('GET', '/api/schedule-runs?page=100000')).statusCode).toBe(200);
  });
});

describe('M5-D: crash between starting the wake and recording the run', () => {
  it('on restart the run is linked to the job that did start, not reported as failed', async () => {
    const { h, s, schedule, runs, repo } = await setup();
    const id = schedule();
    h.clock.set(sp(5, 6, 50, 5));
    const runId = repo.claim(id, sp(5, 6, 50), h.clock.now(), 'executando', null)!;
    const { jobId } = s.wake.start(
      { target: { type: 'rooms', roomIds: [1], includeNoRoom: false }, onlyOffline: false },
      { id: null, label: 'agendamento Manhã' },
      { source: 'schedule', scheduleRunId: runId, preConfirmed: true },
    );
    // ...process died here: the run was never finished.
    s.scheduler.start();
    expect(runs()).toMatchObject([{ status: 'executado', job_id: jobId }]);
  });
});

describe('M5-D: the schedule fires while the room is already being woken by hand', () => {
  it('the run points at the running job instead of failing (no false alarm in the morning card)', async () => {
    const { h, s, room, schedule, runs } = await setup();
    schedule();
    h.clock.set(sp(5, 6, 48));
    s.scheduler.tick();
    const manual = s.wake.start(
      { target: { type: 'rooms', roomIds: [room], includeNoRoom: false }, onlyOffline: false },
      ACTOR,
    );
    h.clock.set(sp(5, 6, 50, 5));
    s.scheduler.tick();
    expect(runs()).toMatchObject([{ status: 'executado', job_id: manual.jobId }]);
    expect(runs()[0]!.detail).toMatch(/em andamento/);
    expect(s.notices.list()).toEqual([]);
  });
});

describe('M5-D: a week with the hub switched off', () => {
  it('logs every lost run but pins only the last 24 hours, not a card per day', async () => {
    const { h, s, schedule, runs, repo } = await setup();
    h.clock.set(sp(1, 6, 0)); // schedules exist since Thursday 1 Oct
    schedule();
    schedule({ name: 'Tarde', timeLocal: '13:00' });
    repo.setLastTick(sp(1, 6, 0));
    h.clock.set(sp(8, 7, 30)); // back the next Thursday, after 06:50
    s.scheduler.tick();
    expect(runs().filter((r) => r.status === 'perdido').length).toBeGreaterThanOrEqual(10);
    // Only the last 24 h are pinned (yesterday 13:00 and today 06:50), not a card per day.
    const pinned = s.notices.list().flatMap((c) => (c.data as unknown as MorningResult).runs);
    expect(pinned.map((r) => r.plannedAt)).toEqual([sp(7, 13), sp(8, 6, 50)]);
  });
});

describe('M5-D: clock jumps across midnight', () => {
  it('a jump forward over a 00:05 run executes it late; a jump back never repeats it', async () => {
    const { h, s, schedule, runs } = await setup();
    h.clock.set(sp(4, 20, 0));
    schedule({ weekdays: 127, timeLocal: '00:05' });
    h.clock.set(sp(4, 23, 50));
    s.scheduler.tick();
    h.clock.jump(25 * 60_000); // 00:15 on the 5th
    s.scheduler.tick();
    expect(runs()).toMatchObject([{ status: 'atrasado', detail: 'atrasado (10 min)' }]);
    h.clock.jump(-30 * 60_000); // 23:45 on the 4th
    for (let t = 0; t < 120; t++) {
      h.clock.advance(15_000);
      s.scheduler.tick();
    }
    expect(runs()).toHaveLength(1);
  });
});

describe('M5-D: the same action twice in parallel', () => {
  it('two pauses, two resumes and a double delete behave', async () => {
    const { s, call, schedule } = await setup();
    const [a, b] = await Promise.all([
      call('POST', '/api/scheduler/pause', { reason: 'A' }),
      call('POST', '/api/scheduler/pause', { reason: 'B' }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(s.dashboard.dashboard().pause?.reason).toMatch(/^[AB]$/);
    const r = await Promise.all([
      call('POST', '/api/scheduler/resume'),
      call('POST', '/api/scheduler/resume'),
    ]);
    expect(r.map((x) => x.statusCode)).toEqual([204, 204]);
    const id = schedule();
    const d = await Promise.all([
      call('DELETE', `/api/schedules/${id}`),
      call('DELETE', `/api/schedules/${id}`),
    ]);
    expect(d.map((x) => x.statusCode).sort()).toEqual([204, 404]);
  });
});
