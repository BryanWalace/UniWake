/**
 * v1.6 field fixes (spec §6d, ADR-053/054): scheduled shutdown through the agenda (pull) and the
 * hub's order (push), executed once, reconciled; the scheduled wake unchanged. Fake agents only:
 * nothing is shut down and nothing leaves the process.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { T0 } from './helpers/db';
import { agentWorld, type AgentWorld } from './helpers/fake-agent';

const ACTOR = { id: null, label: 'teste' };
const MIN = 60_000;
const worlds: AgentWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});

async function lab() {
  const w = await agentWorld();
  worlds.push(w);
  const s = w.h.services;
  const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
  const other = s.rooms.create({ name: 'Lab 2' }, ACTOR);
  const tag = s.tags.create({ name: 'Aula' }, ACTOR);
  const dev = (name: string, mac: string, roomId: number, tagIds: number[] = []) =>
    s.devices.create({ name, mac, roomId, tagIds }, ACTOR).device.id;
  const inRoom = dev('LAB1-PC01', '00:AA:00:00:00:01', room.id);
  const tagged = dev('LAB2-PC01', '00:AA:00:00:00:02', other.id, [tag.id]);
  const single = dev('LAB2-PC02', '00:AA:00:00:00:03', other.id);
  const untouched = dev('LAB2-PC03', '00:AA:00:00:00:04', other.id);
  return { w, s, room, other, tag, inRoom, tagged, single, untouched };
}

/** T0 is 06:00 in São Paulo: a 06:30 shutdown is 30 minutes ahead. */
const AT_0630 = T0 + 30 * MIN;

describe('pull: the agenda (FR-501.1)', () => {
  it('AC-501-01: room-, tag- and device-targeted schedules reach exactly their devices', async () => {
    const { w, s, room, tag, inRoom, tagged, single, untouched } = await lab();
    for (const target of [
      { type: 'rooms' as const, roomIds: [room.id] },
      { type: 'tags' as const, tagIds: [tag.id] },
      { type: 'devices' as const, deviceIds: [single] },
    ]) {
      s.schedules.create(
        {
          name: `Desligar ${target.type}`,
          weekdays: 127,
          timeLocal: '06:30',
          target,
          action: 'shutdown',
        },
        ACTOR,
      );
    }
    for (const id of [inRoom, tagged, single]) {
      const a = w.agent(id);
      expect(await a.checkin()).toBe(true);
      expect(a.agenda!.items[0]).toMatchObject({ at: AT_0630, action: 'shutdown' });
    }
    const none = w.agent(untouched);
    await none.checkin();
    expect(none.agenda!.items).toEqual([]);
  });

  it('AC-501-01: the version changes on create, edit, disable, enable and delete', async () => {
    const { w, s, room, inRoom } = await lab();
    const a = w.agent(inRoom);
    const versions: string[] = [];
    const served = async () => {
      await a.checkin();
      versions.push(a.agenda!.version);
      return a.agenda!;
    };
    expect((await served()).items).toEqual([]);
    const id = s.schedules.create(
      {
        name: 'Desligar',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    ).id;
    expect((await served()).items.length).toBeGreaterThan(0);
    s.schedules.update(id, { timeLocal: '06:40' }, ACTOR);
    expect((await served()).items[0]!.at).toBe(T0 + 40 * MIN);
    s.schedules.update(id, { enabled: false }, ACTOR);
    expect((await served()).items).toEqual([]);
    s.schedules.update(id, { enabled: true }, ACTOR);
    expect((await served()).items.length).toBeGreaterThan(0);
    s.schedules.delete(id, ACTOR);
    expect((await served()).items).toEqual([]);
    // Every change gave the agent a different version from the one before.
    for (let i = 1; i < versions.length; i++) expect(versions[i]).not.toBe(versions[i - 1]);
    // ADR-056: the hub remembers what it served (diagnostics, reconciliation).
    expect(
      s.db.get<{ agenda_version: string; agenda_items: number }>(
        'SELECT agenda_version, agenda_items FROM agent_seen WHERE device_id = ?',
        [inRoom],
      ),
    ).toEqual({ agenda_version: versions.at(-1), agenda_items: 0 });
  });
});

describe('push: the hub sends the order (FR-501.2, ADR-053)', () => {
  it('AC-501-02: at T − aviso − 1 min each ready machine gets one order with the run id and policy', async () => {
    const l = await lab();
    const { w, s, room, inRoom } = l;
    const flagged = s.devices.create(
      {
        name: 'LAB1-PROF',
        mac: '00:AA:00:00:00:09',
        roomId: room.id,
        neverScheduledShutdown: true,
      },
      ACTOR,
    ).device.id;
    const excludedTag = s.tags.create({ name: 'Servidor' }, ACTOR);
    const server = s.devices.create(
      { name: 'LAB1-SRV', mac: '00:AA:00:00:00:0A', roomId: room.id, tagIds: [excludedTag.id] },
      ACTOR,
    ).device.id;
    const noAgent = s.devices.create(
      { name: 'LAB1-PC09', mac: '00:AA:00:00:00:0B', roomId: room.id },
      ACTOR,
    ).device.id;
    s.schedules.create(
      {
        name: 'Desligar Lab 1',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
        power: { warningMinutes: 5, allowPostpone: true, postponeMax: 2, postponeMinutes: 15 },
        excludeTagIds: [excludedTag.id],
      },
      ACTOR,
    );
    const agents = [inRoom, flagged, server].map((id) => w.agent(id));
    void noAgent;
    for (const a of agents) await a.checkin();
    w.h.clock.set(AT_0630 - 6 * MIN - 30_000);
    s.scheduler.tick();
    expect(s.db.all('SELECT id FROM power_jobs')).toEqual([]);
    w.h.clock.set(AT_0630 - 6 * MIN);
    s.scheduler.tick();
    s.scheduler.tick(); // a second tick (or a second hub) pushes nothing more
    const jobs = s.db.all<{ uuid: string }>('SELECT uuid FROM power_jobs');
    expect(jobs).toHaveLength(1);
    const occurrence = agents[0]!.agenda!.items[0]!.occurrence;
    expect(jobs[0]!.uuid).toBe(occurrence);
    for (const a of agents) await a.checkin();
    expect(agents[0]!.orders).toEqual([
      expect.objectContaining({
        action: 'shutdown',
        occurrence,
        // 2026-10-18: a PC started after T (or after the order was given) skips it.
        plannedAt: AT_0630,
        issuedAt: AT_0630 - 6 * MIN,
        warningMinutes: 5,
        allowPostpone: true,
        postponeMax: 2,
        postponeMinutes: 15,
      }),
    ]);
    expect(agents[1]!.orders).toEqual([]); // "Nunca desligar por agendamento"
    expect(agents[2]!.orders).toEqual([]); // excluded tag
    const run = s.db.get<{ status: string; detail: string }>(
      'SELECT status, detail FROM schedule_runs',
    );
    expect(run!.status).toBe('executado');
    expect(run!.detail).toMatch(/ordem para 1 máquina\(s\), 1 sem agente pronto, 2 excluída\(s\)/);
  });

  it('AC-501-03 (hub): pull and push of the same occurrence run once', async () => {
    const { w, s, room, inRoom } = await lab();
    s.schedules.create(
      {
        name: 'Desligar',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    );
    const a = w.agent(inRoom);
    await a.checkin();
    w.h.clock.set(AT_0630 - 6 * MIN);
    s.scheduler.tick();
    await a.checkin();
    a.step(w.h.clock.now()); // the order arrives first and runs
    a.step(AT_0630); // the agenda item has the same run id: ignored
    expect(a.executions).toEqual([expect.objectContaining({ path: 'order' })]);
    expect(await a.checkin()).toBe(true); // its report reaches the hub
    const occurrence = a.agenda!.items[0]!.occurrence;
    // Both ids travel: the occurrence (history per schedule run) and the order (path "ordem direta").
    expect(
      s.db.get(
        'SELECT occurrence_uuid AS occurrence, order_uuid IS NOT NULL AS pushed FROM power_reports',
      ),
    ).toEqual({ occurrence, pushed: 1 });
  });

  it('AC-501-04: hub off at fire time → the agenda shuts it down; a late push is ignored', async () => {
    const { w, s, room, inRoom } = await lab();
    s.schedules.create(
      {
        name: 'Desligar',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    );
    const a = w.agent(inRoom);
    await a.checkin();
    const occurrence = a.agenda!.items[0]!.occurrence;
    w.setHub(false); // no check-ins answered, no scheduler ticks
    w.h.clock.set(AT_0630 - 5 * MIN);
    expect(await a.checkin()).toBe(false);
    a.step(w.h.clock.now()); // warning starts from the stored agenda
    expect(a.executions).toEqual([{ runId: occurrence, path: 'agenda', at: AT_0630 - 5 * MIN }]);
    // The hub comes back 20 minutes after T (before T + 60): it still pushes, the agent ignores it.
    w.setHub(true);
    w.h.clock.set(AT_0630 + 20 * MIN);
    s.scheduler.tick();
    expect(s.db.all('SELECT id FROM power_jobs')).toHaveLength(1);
    await a.checkin();
    a.step(w.h.clock.now());
    expect(a.executions).toHaveLength(1);
  });

  it('AC-501-04: past T + 60 min nothing is pushed any more', async () => {
    const { w, s, room } = await lab();
    s.schedules.create(
      {
        name: 'Desligar',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    );
    w.h.clock.set(AT_0630 + 61 * MIN);
    s.scheduler.tick();
    expect(s.db.all('SELECT id FROM power_jobs')).toEqual([]);
  });

  it('AC-501-07: scheduled wake fires exactly as before next to a shutdown schedule', async () => {
    const { w, s, room } = await lab();
    s.schedules.create(
      {
        name: 'Ligar',
        weekdays: 127,
        timeLocal: '06:10',
        target: { type: 'rooms', roomIds: [room.id] },
      },
      ACTOR,
    );
    s.schedules.create(
      {
        name: 'Desligar',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    );
    s.scheduler.tick();
    w.h.clock.set(T0 + 10 * MIN);
    expect(s.scheduler.tick().ran).toBe(1); // the wake, on time
    const runs = s.db.all<{ status: string; job_id: number | null }>(
      'SELECT status, job_id FROM schedule_runs ORDER BY planned_at',
    );
    expect(runs).toEqual([{ status: 'executado', job_id: expect.any(Number) }]);
    expect(s.db.all('SELECT id FROM power_jobs')).toEqual([]); // the shutdown is not due yet
  });
});

describe('reconciliation at T + 10 min (FR-501.4, ADR-054)', () => {
  it('AC-501-05: each machine gets one result with its path; "ainda ligado" gets exactly one retry', async () => {
    const w = await agentWorld();
    worlds.push(w);
    const s = w.h.services;
    const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
    const ids: Record<string, number> = {};
    for (const [i, n] of ['A', 'B', 'C', 'D', 'E', 'F', 'G'].entries()) {
      ids[n] = s.devices.create(
        { name: `PC-${n}`, mac: `00:AA:00:00:00:${String(i + 10)}`, roomId: room.id },
        ACTOR,
      ).device.id;
    }
    const agents = Object.fromEntries(
      ['A', 'B', 'D', 'E', 'F', 'G'].map((n) => [n, w.agent(ids[n]!)]),
    );
    const online = (...names: string[]) => {
      for (const n of names)
        s.db.run(
          "UPDATE device_state SET status = 'online', online_since = ? WHERE device_id = ?",
          [T0 - 3_600_000, ids[n]!],
        );
    };
    s.schedules.create(
      {
        name: 'Desligar Lab 1',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
        power: { warningMinutes: 5, allowPostpone: true, postponeMax: 2, postponeMinutes: 15 },
      },
      ACTOR,
    );
    online('A', 'B', 'D', 'E', 'F', 'G');
    for (const a of Object.values(agents)) await a.checkin(); // 06:00: everyone has the agenda
    agents.D!.userActive = true;

    w.h.clock.set(AT_0630 - 6 * MIN); // 06:24: the hub pushes
    s.scheduler.tick();
    w.h.clock.set(AT_0630 - 5 * MIN); // 06:25: the warning starts
    agents.A!.step(w.h.clock.now()); // A: from its agenda, before hearing the order
    for (const n of ['B', 'D', 'G']) await agents[n]!.checkin(); // orders delivered
    agents.B!.step(w.h.clock.now()); // B: runs the order
    w.h.clock.set(AT_0630 + 9 * MIN);
    for (const n of ['A', 'B', 'D', 'G']) await agents[n]!.checkin(); // reports in; D and G still on
    online('D', 'G');
    // E: checked in after the warning start with an agenda holding nothing (the v1.4.0 symptom).
    s.db.run('UPDATE agent_seen SET seen_at = ?, agenda_items = 0 WHERE device_id = ?', [
      AT_0630 + 9 * MIN,
      ids.E!,
    ]);
    // F: never heard of since 06:00.

    w.h.clock.set(AT_0630 + 10 * MIN);
    s.scheduler.tick();
    const occurrence = agents.A!.agenda!.items[0]!.occurrence;
    const result = s.powerStatus
      .history()
      .occurrences.find((o) => o.occurrence === occurrence)!
      .devices.map((d) => [d.name, d.result, d.path]);
    expect(result).toEqual([
      ['PC-A', 'done', 'agenda'],
      ['PC-B', 'done', 'order'],
      ['PC-C', 'no_agent', null],
      ['PC-D', 'postponed_active', null],
      ['PC-E', 'stale_agenda', null],
      ['PC-F', 'no_answer', null],
      ['PC-G', 'still_on', null],
    ]);
    const ordersOf = (n: string) =>
      s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM power_orders WHERE device_id = ?', [
        ids[n]!,
      ])!.n;
    expect(ordersOf('G')).toBe(2); // the push and one retry
    expect(ordersOf('D')).toBe(1); // postponing: no retry
    const run = s.db.get<{ detail: string }>('SELECT detail FROM schedule_runs')!;
    expect(run.detail).toMatch(/conferência às T\+10: 2 desligou/);
    expect(run.detail).toMatch(/pela agenda: 1, por ordem direta: 1/);
    expect(run.detail).toMatch(/nova tentativa para 1/);
    // Once: later ticks neither reconcile again nor retry again.
    w.h.clock.set(AT_0630 + 20 * MIN);
    s.scheduler.tick();
    expect(ordersOf('G')).toBe(2);
    expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM power_reconciled')!.n).toBe(1);
  });
});

describe('the PC running the hub (FR-501.5)', () => {
  it('AC-501-06: the shutdown preview names the hub PC among the targets', async () => {
    const { w, s, room } = await lab();
    // The fake hub NIC is 00:11:22:33:44:55 / 10.0.3.15: an inventory device with that MAC is this PC.
    s.devices.create({ name: 'PC-TI', mac: '00:11:22:33:44:55', roomId: room.id }, ACTOR);
    const cookie = await w.h.as('operator');
    const r = await w.h.inject({
      method: 'POST',
      url: '/api/power/preview',
      cookie,
      payload: { action: 'shutdown', target: { type: 'rooms', roomIds: [room.id] } },
    });
    expect(r.json<{ self: { name: string }[] }>().self.map((d) => d.name)).toEqual(['PC-TI']);
    const other = await w.h.inject({
      method: 'POST',
      url: '/api/power/preview',
      cookie,
      payload: { action: 'shutdown', target: { type: 'rooms', roomIds: [s.rooms.list()[1]!.id] } },
    });
    expect(other.json<{ self: unknown[] }>().self).toEqual([]);
  });
});

describe('field scenario: push only (V6-T01)', () => {
  it('a machine whose agenda misses the schedule (the v1.4.0 symptom) still shuts down by order', async () => {
    const { w, s, room, inRoom } = await lab();
    s.schedules.create(
      {
        name: 'Desligar',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    );
    const a = w.agent(inRoom);
    const emptyAgenda = async () => {
      await a.checkin();
      a.agenda = { ...a.agenda!, items: [] }; // what the field PC held
    };
    await emptyAgenda();
    w.h.clock.set(AT_0630 - 6 * MIN);
    s.scheduler.tick();
    await emptyAgenda();
    a.step(w.h.clock.now());
    a.step(AT_0630);
    expect(a.executions).toEqual([expect.objectContaining({ path: 'order' })]);
    await a.checkin();
    w.h.clock.set(AT_0630 + 10 * MIN);
    s.scheduler.tick();
    const run = s.db.get<{ detail: string }>('SELECT detail FROM schedule_runs');
    expect(run!.detail).toContain('conferência às T+10: 1 desligou');
    expect(run!.detail).toContain('por ordem direta: 1');
  });
});
