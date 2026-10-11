/** M16-D break-it pass (tasks.md checklist) for the v1.3 foundations. */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { HubKeyService } from '../src/application/power/hub-key';
import { DevSecretProtector } from '../src/adapters/secret-protector';
import { buildAgenda, type AgendaSchedule } from '../src/domain/agenda';
import { SqliteHubKeysRepo } from '../src/db/repositories/hub-keys-repo';
import { changeLog } from '../src/db/sync/change-log';
import { scheduleRunUuid } from '../src/db/sync/uuid';
import { FakeClock } from './fakes/fake-clock';
import { MemoryLogger } from './fakes/system-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0, testDb } from './helpers/db';

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

describe('M16-D: the hub never wakes machines for a shutdown schedule', () => {
  it('a "Desligar" schedule at 22:40 creates no run and no wake job; a "Ligar" one still runs', async () => {
    const h = await apiHarness();
    hs.push(h);
    const s = h.services;
    const room = s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    s.devices.create({ name: 'PC-1', mac: '00:FF:00:00:00:01', roomId: room }, ACTOR);
    const create = (name: string) =>
      s.schedules.create(
        { name, weekdays: 31, timeLocal: '22:40', target: { type: 'rooms', roomIds: [room] } },
        ACTOR,
      ).id;
    const off = create('Desligar 22:40');
    h.services.db.run(
      "UPDATE schedules SET action = 'shutdown', warning_minutes = 5 WHERE id = ?",
      [off],
    );
    changeLog(h.services.db).touch('schedule', off);

    h.clock.set(sp(5, 22, 39));
    s.scheduler.tick();
    h.clock.set(sp(5, 22, 40, 5));
    s.scheduler.tick();
    const runs = () =>
      h.services.db.all<{ schedule_id: number }>(
        'SELECT schedule_id FROM schedule_runs ORDER BY id',
      );
    expect(runs()).toEqual([]);
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM wake_jobs')!.n).toBe(0);

    const on = create('Ligar 22:40'); // same minute, wake action
    h.clock.set(sp(6, 22, 39));
    s.scheduler.tick();
    h.clock.set(sp(6, 22, 40, 5));
    s.scheduler.tick();
    expect(runs().map((r) => r.schedule_id)).toEqual([on]);
  });
});

describe('M16-D: hub key under parallel start', () => {
  it('two init calls at once make one key, not two active ones', async () => {
    const db = testDb();
    const svc = new HubKeyService({
      repo: new SqliteHubKeysRepo(db),
      protector: new DevSecretProtector(),
      clock: new FakeClock(T0),
      logger: new MemoryLogger(),
    });
    await Promise.all([svc.init(), svc.init(), svc.init()]);
    expect(
      db.get<{ n: number }>('SELECT COUNT(*) AS n FROM hub_keys WHERE retired_at IS NULL')!.n,
    ).toBe(1);
    await svc.init(); // a later call reloads the same key
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM hub_keys')!.n).toBe(1);
    db.close();
  });
});

describe('M16-D: agenda at clock edges', () => {
  const schedule = (over: Partial<AgendaSchedule>): AgendaSchedule => ({
    id: 1,
    uuid: 'cccccccc-0000-4000-8000-000000000001',
    enabled: true,
    action: 'shutdown',
    weekdays: 127,
    timeLocal: '22:40',
    timezone: 'America/Sao_Paulo',
    target: { type: 'all' },
    warningMinutes: 5,
    allowPostpone: true,
    postponeMax: 2,
    postponeMinutes: 15,
    excludeTags: [],
    ...over,
  });
  const agenda = (s: AgendaSchedule, now: number) =>
    buildAgenda({
      device: {
        id: 1,
        roomId: null,
        tagIds: [],
        tagUuids: [],
        enabled: true,
        neverScheduledShutdown: false,
      },
      schedules: [s],
      exceptions: [],
      pause: null,
      now,
      occurrenceId: scheduleRunUuid,
      digest: (t) => createHash('sha256').update(t).digest('hex'),
    });

  it('a zone with DST: the repeated hour runs once, the skipped one runs when clocks jump', () => {
    // New York 2026: clocks go back on 1 Nov (01:30 happens twice), forward on 14 Mar 2027.
    const back = agenda(
      schedule({ timeLocal: '01:30', timezone: 'America/New_York' }),
      Date.UTC(2026, 9, 31, 12),
    );
    const nov1 = back.items.filter(
      (i) => i.at >= Date.UTC(2026, 10, 1) && i.at < Date.UTC(2026, 10, 2),
    );
    expect(nov1.map((i) => i.at)).toEqual([Date.UTC(2026, 10, 1, 5, 30)]); // first 01:30 (EDT)
    const fwd = agenda(
      schedule({ timeLocal: '02:30', timezone: 'America/New_York' }),
      Date.UTC(2027, 2, 13, 12),
    );
    expect(fwd.items.map((i) => i.at)).toContain(Date.UTC(2027, 2, 14, 7)); // 03:00 EDT
  });

  it('a midnight schedule lands on local midnight; consecutive days stay one day apart', () => {
    const a = agenda(schedule({ timeLocal: '00:00' }), sp(12, 12));
    expect(a.items[0]!.at).toBe(sp(13, 0));
    const gaps = a.items.slice(1).map((i, k) => i.at - a.items[k]!.at);
    expect(new Set(gaps)).toEqual(new Set([86_400_000]));
  });

  it('a clock jumped an hour either way gives a consistent agenda (pure function of now)', () => {
    const s = schedule({});
    const base = agenda(s, sp(12, 22, 0));
    const ahead = agenda(s, sp(12, 23, 0));
    const behind = agenda(s, sp(12, 21, 0));
    expect(ahead.items[0]!.at).toBe(sp(12, 22, 40)); // passed, still within the 6 h look-back
    expect(behind.items).toEqual(base.items);
    expect(behind.version).toBe(base.version);
  });
});
