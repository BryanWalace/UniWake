/**
 * v1.6 diagnostics (FR-502, FR-504.1, ADR-056): why a machine will (not) shut down on a schedule,
 * the agenda it was given, and the "possível máquina duplicada" notice from enrollment.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatedEnrollmentToken, ShutdownDiagnostics } from '@uniwake/shared';
import { agentWorld, type AgentWorld } from './helpers/fake-agent';
import { T0 } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const MIN = 60_000;
const worlds: AgentWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});

async function world() {
  const w = await agentWorld({ prepareScript: { bytes: () => Buffer.from('script') } });
  worlds.push(w);
  return { w, s: w.h.services, cookie: await w.h.as('operator') };
}

describe('why a machine will (not) shut down (FR-502.1)', () => {
  it('AC-502-01: each "Desligar" schedule is listed with its reason; the included one with its next time', async () => {
    const { w, s, cookie } = await world();
    const lab1 = s.rooms.create({ name: 'Lab 1' }, ACTOR);
    const lab2 = s.rooms.create({ name: 'Lab 2' }, ACTOR);
    const prof = s.tags.create({ name: 'Professor' }, ACTOR);
    const pc = s.devices.create(
      { name: 'LAB1-PC01', mac: '00:AA:00:00:00:01', roomId: lab1.id, tagIds: [prof.id] },
      ACTOR,
    ).device.id;
    const mk = (name: string, extra: Record<string, unknown>) =>
      s.schedules.create(
        { name, weekdays: 127, timeLocal: '06:30', action: 'shutdown', ...extra } as never,
        ACTOR,
      );
    mk('Desligar Lab 1', { target: { type: 'rooms', roomIds: [lab1.id] } });
    mk('Desligar Lab 2', { target: { type: 'rooms', roomIds: [lab2.id] } });
    mk('Desligar sem professor', {
      target: { type: 'rooms', roomIds: [lab1.id] },
      excludeTagIds: [prof.id],
    });
    const off = mk('Desligado', { target: { type: 'rooms', roomIds: [lab1.id] } });
    s.schedules.update(off.id, { enabled: false }, ACTOR);
    s.schedules.create(
      {
        name: 'Ligar',
        weekdays: 127,
        timeLocal: '07:00',
        target: { type: 'rooms', roomIds: [lab1.id] },
      },
      ACTOR,
    );
    const a = w.agent(pc);
    await a.checkin();
    const r = await w.h.inject({
      method: 'GET',
      url: `/api/devices/${pc}/shutdown-diagnostics`,
      cookie,
    });
    expect(r.statusCode).toBe(200);
    const d = r.json<ShutdownDiagnostics>();
    expect(d.schedules.map((x) => [x.name, x.reason])).toEqual([
      ['Desligado', 'schedule_disabled'],
      ['Desligar Lab 1', 'included'],
      ['Desligar Lab 2', 'not_in_target'],
      ['Desligar sem professor', 'excluded_tag'],
    ]); // by name; the wake schedule is not listed
    expect(d.schedules[1]!.nextAt).toBe(T0 + 30 * MIN);
    expect(d.agenda).toMatchObject({
      servedItems: a.agenda!.items.length,
      servedVersion: a.agenda!.version,
      currentVersion: a.agenda!.version,
      nextShutdownAt: T0 + 30 * MIN,
    });
    expect(d.lastShutdown).toBeNull();

    // "Nunca desligar por agendamento" wins over everything else.
    s.devices.update(pc, { neverScheduledShutdown: true }, ACTOR);
    const again = (
      await w.h.inject({ method: 'GET', url: `/api/devices/${pc}/shutdown-diagnostics`, cookie })
    ).json<ShutdownDiagnostics>();
    expect(again.schedules[1]!.reason).toBe('never_flag');
  });

  it('AC-502-02: enrollment that creates a device named like another one leaves a duplicate notice', async () => {
    const { w, s, cookie } = await world();
    const room = s.rooms.create({ name: 'Lab 3' }, ACTOR);
    s.devices.create({ name: 'LAB3-PC01', mac: '00:AA:00:00:00:31', roomId: room.id }, ACTOR);
    const tok = (
      await w.h.inject({
        method: 'POST',
        url: '/api/enrollment/tokens',
        cookie,
        payload: { roomId: room.id },
      })
    ).json<CreatedEnrollmentToken>().token;
    // The same PC prepared with another network card: a new record, same computer name.
    const r = await w.listener.inject({
      method: 'POST',
      url: '/agent/enroll',
      remoteAddress: '10.0.3.41',
      headers: { host: '10.0.3.15:47101', authorization: `Bearer ${tok}` },
      payload: { roomCode: 'LAB3', mac: '00-AA-00-00-00-99', hostname: 'lab3-pc01' },
    });
    expect(r.json<{ result: string }>().result).toBe('created');
    const notice = s.db.get<{ type: string; data: string }>(
      "SELECT type, data FROM notices WHERE type = 'possible_duplicate'",
    );
    expect(JSON.parse(notice!.data)).toMatchObject({
      otherName: 'LAB3-PC01',
      otherMac: '00:AA:00:00:00:31',
      mac: '00:AA:00:00:00:99',
    });
  });
});

describe('"Testar agendamento" (FR-504.3)', () => {
  async function prepared() {
    const { w, s, cookie } = await world();
    const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
    const pc = s.devices.create(
      { name: 'LAB1-PC01', mac: '00:AA:00:00:00:01', roomId: room.id },
      ACTOR,
    ).device.id;
    const a = w.agent(pc);
    await a.checkin();
    const test = (minutes: number, id = pc) =>
      w.h.inject({
        method: 'POST',
        url: `/api/devices/${id}/shutdown-test`,
        cookie,
        payload: { minutes },
      });
    const diag = async () =>
      (
        await w.h.inject({ method: 'GET', url: `/api/devices/${pc}/shutdown-diagnostics`, cookie })
      ).json<ShutdownDiagnostics>();
    return { w, s, cookie, room, pc, a, test, diag };
  }

  it('AC-504-01: a test in 5 minutes reaches the agenda and the push, runs once and is reconciled', async () => {
    const { w, s, cookie, a, test, diag } = await prepared();
    const r = await test(5);
    expect(r.statusCode).toBe(201);
    const t = r.json<NonNullable<ShutdownDiagnostics['test']>>();
    expect(t).toMatchObject({ at: T0 + 5 * MIN, pushedAt: null, result: null });
    const lead = (t.warningMinutes + 1) * MIN;

    // Pull: the agenda the machine gets at its next check-in has the one-off (version changed).
    const before = a.agenda!.version;
    await a.checkin();
    expect(a.agenda!.version).not.toBe(before);
    expect(a.agenda!.items).toEqual([
      expect.objectContaining({ occurrence: t.uuid, at: t.at, warningMinutes: t.warningMinutes }),
    ]);

    // Push: at T − aviso − 1 min, one order carrying the same run id.
    w.h.clock.set(t.at - lead - 30_000);
    s.scheduler.tick();
    expect(s.db.all('SELECT id FROM power_jobs')).toEqual([]);
    w.h.clock.set(t.at - lead);
    s.scheduler.tick();
    s.scheduler.tick();
    expect(s.db.all<{ uuid: string }>('SELECT uuid FROM power_jobs')).toEqual([{ uuid: t.uuid }]);
    await a.checkin();
    expect(a.orders).toEqual([expect.objectContaining({ occurrence: t.uuid })]);
    expect((await diag()).test!.pushedAt).toBe(t.at - lead);

    // One execution whatever path reaches it first.
    a.step(t.at - lead);
    a.step(t.at - t.warningMinutes * MIN);
    expect(a.executions).toEqual([expect.objectContaining({ runId: t.uuid, path: 'order' })]);
    await a.checkin(); // delivers the report

    // Reconciliation at T + 10 min, the result on the device page and in the history.
    w.h.clock.set(t.at + 10 * MIN);
    s.scheduler.tick();
    const rec = s.db.get<{ counts: string }>(
      'SELECT counts FROM power_reconciled WHERE occurrence = ?',
      [t.uuid],
    );
    expect(JSON.parse(rec!.counts)).toEqual({ done: 1, retried: 0 });
    expect((await diag()).test).toMatchObject({
      uuid: t.uuid,
      result: 'done',
      path: 'order',
      reconciledAt: t.at + 10 * MIN,
    });
    const history = (await w.h.inject({ method: 'GET', url: '/api/power/history', cookie })).json<{
      occurrences: { occurrence: string; scheduleName: string | null; counts: { done: number } }[];
    }>();
    expect(history.occurrences.find((o) => o.occurrence === t.uuid)).toMatchObject({
      scheduleName: 'Testar agendamento (LAB1-PC01)',
      counts: { done: 1 },
    });
  });

  it('AC-504-01: with the hub off at the push time, the agenda alone shuts the machine down', async () => {
    const { w, s, a, test, diag } = await prepared();
    const t = (await test(3)).json<NonNullable<ShutdownDiagnostics['test']>>();
    await a.checkin();
    w.setHub(false); // no check-in answers and no scheduler ticks until T + 10
    a.step(t.at - t.warningMinutes * MIN);
    expect(a.executions).toEqual([expect.objectContaining({ runId: t.uuid, path: 'agenda' })]);
    w.setHub(true);
    w.h.clock.set(t.at + 10 * MIN);
    await a.checkin(); // the report arrives when the hub is back
    s.scheduler.tick(); // the late push still goes out (ADR-053), the agent answers already_done
    await a.checkin();
    a.step(t.at + 10 * MIN);
    expect(a.executions).toHaveLength(1);
    expect((await diag()).test).toMatchObject({ result: 'done', path: 'agenda' });
  });

  it('refuses a machine without an agent, a protected machine and an out-of-range delay', async () => {
    const { s, room, pc, test } = await prepared();
    const bare = s.devices.create(
      { name: 'LAB1-PC02', mac: '00:AA:00:00:00:02', roomId: room.id },
      ACTOR,
    ).device.id;
    expect((await test(5, bare)).json<{ code: string }>().code).toBe('POWER_TEST_NOT_READY');
    s.devices.update(pc, { neverScheduledShutdown: true }, ACTOR);
    expect((await test(5)).json<{ code: string }>().code).toBe('POWER_TEST_PROTECTED');
    expect((await test(1)).statusCode).toBe(422);
    expect((await test(61)).statusCode).toBe(422);
    expect(s.db.all('SELECT id FROM power_tests')).toEqual([]);
  });
});

describe('info logs (FR-504.2)', () => {
  it('logs fires, agenda changes, agendas served, pushes and reconciliations — once each', async () => {
    const { w, s } = await world();
    const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
    const pc = s.devices.create(
      { name: 'LAB1-PC01', mac: '00:AA:00:00:00:01', roomId: room.id },
      ACTOR,
    ).device.id;
    const log = w.h.ports.logger.entries;
    const lines = (msg: string) => log.filter((e) => e.level === 'info' && e.msg === msg);
    const a = w.agent(pc);
    await a.checkin();
    // As the monitor would see it (an agent check-in counts as online, ADR-055): not one to wake.
    s.db.run("UPDATE device_state SET status = 'online', online_since = ? WHERE device_id = ?", [
      w.h.clock.now(),
      pc,
    ]);
    const sched = s.schedules.create(
      {
        name: 'Desligar Lab 1',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    );
    await a.checkin();
    await a.checkin(); // nothing new: nothing logged
    expect(lines('agenda changed')).toEqual([
      expect.objectContaining({
        obj: expect.objectContaining({ deviceId: pc, items: 14, version: a.agenda!.version }),
      }),
    ]);
    expect(lines('agenda served with a new version')).toHaveLength(2); // empty, then 14 daily items
    expect(lines('agenda served with a new version')[1]!.obj).toMatchObject({
      deviceId: pc,
      version: a.agenda!.version,
      items: 14,
    });

    const occurrence = a.agenda!.items[0]!.occurrence;
    w.h.clock.set(T0 + 24 * MIN);
    s.scheduler.tick();
    s.scheduler.tick();
    expect(lines('schedule fired')).toEqual([
      expect.objectContaining({
        obj: expect.objectContaining({
          action: 'shutdown',
          scheduleId: sched.id,
          schedule: 'Desligar Lab 1',
          targets: expect.objectContaining({ type: 'rooms', roomIds: [room.id] }),
        }),
      }),
    ]);
    expect(lines('scheduled shutdown pushed')).toEqual([
      expect.objectContaining({ obj: expect.objectContaining({ occurrence, count: 1 }) }),
    ]);

    await a.checkin();
    a.step(T0 + 24 * MIN);
    await a.checkin();
    w.h.clock.set(T0 + 40 * MIN);
    s.scheduler.tick();
    s.scheduler.tick();
    expect(lines('scheduled shutdown reconciled')).toEqual([
      expect.objectContaining({
        obj: expect.objectContaining({ occurrence, counts: { done: 1 } }),
      }),
    ]);

    // A wake schedule's fire carries the same fields.
    s.schedules.create(
      {
        name: 'Ligar Lab 1',
        weekdays: 127,
        timeLocal: '06:45',
        target: { type: 'rooms', roomIds: [room.id] },
      },
      ACTOR,
    );
    w.h.clock.set(T0 + 45 * MIN);
    s.scheduler.tick();
    expect(lines('schedule fired').map((e) => (e.obj as { action: string }).action)).toEqual([
      'shutdown',
      'wake',
    ]);
  });
});

describe('"Testar agendamento" robustness', () => {
  it('a test whose reconciliation throws does not stop the others', async () => {
    const { w, s } = await world();
    const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
    const ids = ['00:AA:00:00:00:01', '00:AA:00:00:00:02'].map(
      (mac, i) =>
        s.devices.create({ name: `LAB1-PC0${i + 1}`, mac, roomId: room.id }, ACTOR).device.id,
    );
    for (const id of ids) await w.agent(id).checkin();
    for (const id of ids) s.shutdownTests.create(id, 5, ACTOR);
    const status = s.powerStatus;
    const original = status.occurrenceReportsOf.bind(status);
    let calls = 0;
    status.occurrenceReportsOf = (occ, at) => {
      if (calls++ === 0) throw new Error('boom');
      return original(occ, at);
    };
    s.shutdownTests.tick(T0 + 20 * MIN);
    expect(s.db.all('SELECT id FROM power_tests WHERE reconciled_at IS NOT NULL')).toHaveLength(1);
    expect(
      w.h.ports.logger.entries.some(
        (e) => e.msg === 'scheduled shutdown test reconciliation failed',
      ),
    ).toBe(true);
  });
});
