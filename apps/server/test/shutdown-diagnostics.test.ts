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
