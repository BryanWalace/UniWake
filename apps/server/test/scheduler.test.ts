import { afterEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/application/schedules/scheduler';
import { SqliteSchedulerRepo } from '../src/db/repositories/scheduler-repo';
import { createServices, type Services } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { MemoryLogger } from './fakes/system-fakes';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const MIN = 60_000;
/** Local São Paulo wall time (UTC−3) on a day of October 2026. */
const sp = (day: number, h: number, m = 0, s = 0) => Date.UTC(2026, 9, day, h + 3, m, s);

const worlds: Services[] = [];
afterEach(async () => {
  for (const s of worlds.splice(0)) {
    s.scheduler.stop();
    for (let i = 0; i < 400 && s.runner.activeCount > 0; i++)
      await (s.clock as FakeClock).advanceAsync(5_000);
    s.db.close();
  }
});

function world() {
  const db = testDb();
  const clock = new FakeClock(T0); // Mon 5 Oct 2026 06:00 local
  const ports = fakePorts(clock);
  const s = createServices(db, clock, ports);
  worlds.push(s);
  const room = s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
  for (let i = 0; i < 2; i++) {
    s.devices.create(
      { name: `PC-${i}`, mac: `00:DD:00:00:00:0${i}`, roomId: room, ip: `10.0.3.${i + 10}` },
      ACTOR,
    );
  }
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
  const runs = () =>
    db.all<{
      schedule_id: number;
      planned_at: number;
      status: string;
      detail: string | null;
      job_id: number | null;
    }>(
      'SELECT schedule_id, planned_at, status, detail, job_id FROM schedule_runs ORDER BY planned_at, id',
    );
  const jobs = () =>
    db.all<{ id: number; source: string; schedule_run_id: number | null }>(
      'SELECT id, source, schedule_run_id FROM wake_jobs',
    );
  const repo = new SqliteSchedulerRepo(db);
  return { s, db, clock, ports, room, schedule, runs, jobs, repo };
}

describe('scheduler: on time (FR-005.3)', () => {
  it('runs a due schedule once, as "executado", creating a scheduled wake job linked to the run', () => {
    const w = world();
    const id = w.schedule();
    w.clock.set(sp(5, 6, 49, 45));
    expect(w.s.scheduler.tick()).toEqual({ ran: 0, logged: 0 });
    w.clock.set(sp(5, 6, 50, 5));
    expect(w.s.scheduler.tick()).toEqual({ ran: 1, logged: 0 });
    const [run] = w.runs();
    expect(run).toMatchObject({
      schedule_id: id,
      planned_at: sp(5, 6, 50),
      status: 'executado',
      detail: null,
    });
    const [job] = w.jobs();
    expect(job).toMatchObject({ id: run!.job_id, source: 'schedule' });
    expect(w.s.wake.job(job!.id).job.requestedBy).toBe('agendamento');
    expect(w.s.scheduler.tick()).toEqual({ ran: 0, logged: 0 });
  });

  it('AC-005-03: two schedulers racing for the same due run create exactly one job', () => {
    const w = world();
    w.schedule();
    w.clock.set(sp(5, 6, 49));
    w.s.scheduler.tick();
    const twin = new Scheduler({
      repo: new SqliteSchedulerRepo(w.db),
      refs: { room: () => true, tag: () => true, device: () => true },
      startWake: (req, actor, opts) => w.s.wake.start(req, actor, opts),
      settings: w.s.settings,
      clock: w.clock,
      events: w.s.events,
      logger: new MemoryLogger(),
      transaction: (fn) => w.db.transaction(fn),
    });
    w.clock.set(sp(5, 6, 50, 3));
    const a = w.s.scheduler.tick();
    const b = twin.tick();
    expect(a.ran + b.ran).toBe(1);
    expect(w.jobs()).toHaveLength(1);
    expect(w.runs()).toHaveLength(1);
  });

  it('AC-005-04: after the clock jumps back 10 minutes, the run does not fire again', () => {
    const w = world();
    w.schedule();
    w.clock.set(sp(5, 6, 49));
    w.s.scheduler.tick();
    w.clock.set(sp(5, 6, 50, 10));
    w.s.scheduler.tick();
    w.clock.jump(-10 * MIN);
    for (let t = 0; t < 80; t++) {
      w.clock.advance(15_000);
      w.s.scheduler.tick();
    }
    expect(w.jobs()).toHaveLength(1);
    expect(w.runs()).toHaveLength(1);
  });

  it('the 15 s loop fires within a tick of the planned time', async () => {
    const w = world();
    w.schedule();
    w.s.scheduler.start();
    await w.clock.advanceAsync(sp(5, 6, 50, 14) - w.clock.now());
    expect(w.runs()).toMatchObject([{ status: 'executado' }]);
  });
});

describe('scheduler: missed runs (FR-005.4)', () => {
  it('AC-005-05: planned 06:50, hub back at 06:58 → "atrasado (8 min)" and the wake runs', () => {
    const w = world();
    w.schedule();
    w.repo.setLastTick(sp(5, 6, 0)); // hub was up at 06:00, then down
    w.clock.set(sp(5, 6, 58));
    w.s.scheduler.tick();
    expect(w.runs()).toMatchObject([{ status: 'atrasado', detail: 'atrasado (8 min)' }]);
    expect(w.jobs()).toHaveLength(1);
  });

  it('AC-005-05: hub back at 07:20 → "perdido", no wake', () => {
    const w = world();
    w.schedule();
    w.repo.setLastTick(sp(5, 6, 0));
    w.clock.set(sp(5, 7, 20));
    w.s.scheduler.tick();
    expect(w.runs()).toMatchObject([{ status: 'perdido', job_id: null }]);
    expect(w.jobs()).toHaveLength(0);
  });

  it('AC-005-08: down Friday 18:00 → Monday 06:55: Monday runs late, Saturday 08:00 is lost', () => {
    const w = world();
    const weekdays = w.schedule();
    const saturday = w.schedule({ name: 'Sábado', weekdays: 32, timeLocal: '08:00' });
    w.clock.set(sp(9, 18));
    w.s.scheduler.tick();
    w.clock.set(sp(12, 6, 55));
    w.s.scheduler.tick();
    const byId = (id: number) => w.runs().filter((r) => r.schedule_id === id);
    expect(byId(weekdays).filter((r) => r.planned_at > sp(9, 18))).toMatchObject([
      { planned_at: sp(12, 6, 50), status: 'atrasado' },
    ]);
    expect(byId(saturday)).toMatchObject([{ planned_at: sp(10, 8), status: 'perdido' }]);
    expect(w.jobs()).toHaveLength(1);
  });

  it('a schedule created after an occurrence does not log that occurrence as lost', () => {
    const w = world();
    w.repo.setLastTick(sp(5, 6, 0));
    w.clock.set(sp(5, 7, 0));
    w.schedule();
    w.s.scheduler.tick();
    expect(w.runs()).toEqual([]);
  });

  it('a week-long outage is not replayed beyond 7 days, and disabled schedules log nothing', () => {
    const w = world();
    w.schedule({ weekdays: 127 });
    w.schedule({ name: 'Off', weekdays: 127, enabled: false });
    w.repo.setLastTick(sp(5, 6, 0) - 30 * 86_400_000);
    w.clock.set(sp(5, 7, 20));
    // created at T0, so only today's occurrence is in range
    w.s.scheduler.tick();
    expect(w.runs().map((r) => r.status)).toEqual(['perdido']);
  });
});

describe('scheduler: skipped and failed runs (FR-005.2, FR-005.8)', () => {
  it('AC-005-02: an exception day logs "pulado (feriado)" with its description and wakes nothing', () => {
    const w = world();
    w.schedule();
    w.s.schedules.createException(
      { startDate: '2026-10-05', description: 'Consciência Negra' },
      ACTOR,
    );
    w.clock.set(sp(5, 6, 49));
    w.s.scheduler.tick();
    w.clock.set(sp(5, 6, 50, 5));
    w.s.scheduler.tick();
    expect(w.runs()).toMatchObject([
      { status: 'pulado_feriado', detail: 'Consciência Negra', job_id: null },
    ]);
    expect(w.jobs()).toHaveLength(0);
  });

  it('AC-005-11: after its room is deleted, the next run logs "falhou (alvo vazio)"', () => {
    const w = world();
    w.schedule();
    w.s.rooms.delete(w.room, true, ACTOR);
    w.clock.set(sp(5, 6, 49));
    w.s.scheduler.tick();
    w.clock.set(sp(5, 6, 50, 5));
    w.s.scheduler.tick();
    expect(w.runs()).toMatchObject([{ status: 'falhou', detail: 'alvo vazio', job_id: null }]);
  });
});

describe('scheduler: faults', () => {
  it('DB busy on the claim: the tick fails, nothing is lost, the next tick runs it once', () => {
    const w = world();
    w.schedule();
    w.clock.set(sp(5, 6, 49));
    w.s.scheduler.tick();
    w.clock.set(sp(5, 6, 50, 5));
    const original = w.db.run.bind(w.db);
    let failures = 1;
    w.db.run = (sql, params) => {
      if (sql.includes('INSERT INTO schedule_runs') && failures-- > 0)
        throw new Error('SQLITE_BUSY');
      return original(sql, params);
    };
    expect(() => w.s.scheduler.tick()).toThrow('SQLITE_BUSY');
    w.db.run = original;
    w.clock.advance(15_000);
    expect(w.s.scheduler.tick().ran).toBe(1);
    expect(w.runs()).toMatchObject([{ status: 'executado' }]);
  });

  it('restart mid-tick: a claim left "executando" becomes "falhou (interrompido)" and never runs again', () => {
    const w = world();
    const id = w.schedule();
    w.clock.set(sp(5, 6, 50, 5));
    w.repo.claim(id, sp(5, 6, 50), w.clock.now(), 'executando', null); // then the process died
    w.s.scheduler.start();
    expect(w.runs()).toMatchObject([
      { status: 'falhou', detail: 'interrompido (o serviço reiniciou)' },
    ]);
    expect(w.s.scheduler.tick().ran).toBe(0);
    expect(w.jobs()).toHaveLength(0);
  });

  it('clock jumps of ±1 h: forward past the grace window loses the run, backward never repeats it', () => {
    const w = world();
    w.schedule();
    w.clock.set(sp(5, 6, 40));
    w.s.scheduler.tick();
    w.clock.jump(65 * MIN); // 07:45
    w.s.scheduler.tick();
    expect(w.runs()).toMatchObject([{ status: 'perdido' }]);
    w.clock.jump(-60 * MIN); // 06:45 again
    for (let t = 0; t < 60; t++) {
      w.clock.advance(15_000);
      w.s.scheduler.tick();
    }
    expect(w.runs()).toHaveLength(1);
    expect(w.jobs()).toHaveLength(0);
  });
});
