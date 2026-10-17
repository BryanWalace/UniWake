/**
 * v1.6.0 (spec §6e, FR-601/602, ADR-058): excluded machines are never hidden, and saving a
 * "Desligar" schedule never shuts machines down at once. Fake agents only: nothing is shut down.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PowerHistory, PowerPreview } from '@uniwake/shared';
import { T0 } from './helpers/db';
import { agentWorld, type AgentWorld } from './helpers/fake-agent';

const ACTOR = { id: null, label: 'teste' };
const MIN = 60_000;
/** T0 is 06:00 in São Paulo: a 06:30 shutdown is 30 minutes ahead. */
const AT_0630 = T0 + 30 * MIN;
const worlds: AgentWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});

/** A room with a normal machine, one "Nunca desligar" and one with the tag the schedule excludes. */
async function lab() {
  const w = await agentWorld();
  worlds.push(w);
  const s = w.h.services;
  const room = s.rooms.create({ name: 'Lab 3' }, ACTOR);
  const prof = s.tags.create({ name: 'Professor' }, ACTOR);
  const dev = (name: string, mac: string, extra: Record<string, unknown> = {}) =>
    s.devices.create({ name, mac, roomId: room.id, ...extra }, ACTOR).device.id;
  const normal = dev('LAB3-PC01', '00:AA:00:00:00:31');
  const never = dev('LAB3-PC02', '00:AA:00:00:00:32', { neverScheduledShutdown: true });
  const tagged = dev('LAB3-PROF', '00:AA:00:00:00:33', { tagIds: [prof.id] });
  const agents = [normal, never, tagged].map((id) => w.agent(id));
  for (const a of agents) await a.checkin();
  return { w, s, room, prof, normal, never, tagged, agents, cookie: await w.h.as('operator') };
}

describe('excluded machines are listed with the reason (FR-601)', () => {
  it('AC-601-01: the schedule reach does not count them and names each reason', async () => {
    const { w, room, prof, cookie } = await lab();
    const preview = async (schedule?: { excludeTagIds: number[] }) =>
      (
        await w.h.inject({
          method: 'POST',
          url: '/api/power/preview',
          cookie,
          payload: {
            action: 'shutdown',
            target: { type: 'rooms', roomIds: [room.id] },
            warning: 'standard',
            ...(schedule ? { schedule } : {}),
          },
        })
      ).json<PowerPreview>();
    const reach = await preview({ excludeTagIds: [prof.id] });
    expect(reach.count).toBe(1);
    expect(reach.excluded).toEqual([
      { deviceId: expect.any(Number), name: 'LAB3-PC02', reason: 'never_flag' },
      { deviceId: expect.any(Number), name: 'LAB3-PROF', reason: 'excluded_tag' },
    ]);
    expect(reach.protected).toEqual([]); // nothing to confirm in a schedule
    // The manual "Desligar" keeps its v1.3 rule: the flagged machine is included with a confirmation.
    const manual = await preview();
    expect(manual.count).toBe(3);
    expect(manual.excluded).toEqual([]);
    expect(manual.protected.map((d) => d.name)).toEqual(['LAB3-PC02']);
  });
});

describe('excluded machines in the reconciliation and the history (FR-601.2)', () => {
  it('AC-601-02: the run detail and the history list them as excluded, with the reason', async () => {
    const { w, s, room, prof, agents, cookie } = await lab();
    s.schedules.create(
      {
        name: 'Desligar Lab 3',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
        excludeTagIds: [prof.id],
      },
      ACTOR,
    );
    w.h.clock.set(AT_0630 - 6 * MIN);
    s.scheduler.tick();
    for (const a of agents) await a.checkin();
    agents[0]!.step(w.h.clock.now());
    await agents[0]!.checkin();
    w.h.clock.set(AT_0630 + 10 * MIN);
    s.scheduler.tick();
    const run = s.db.get<{ detail: string }>('SELECT detail FROM schedule_runs');
    expect(run!.detail).toContain('2 excluída(s)'); // the push line, as before
    expect(run!.detail).toContain(
      'conferência às T+10: 1 desligou, 2 excluídas do agendamento (1 nunca desligar por agendamento, 1 etiqueta excluída neste agendamento)',
    );
    expect(run!.detail).not.toContain('nenhuma máquina no alvo');
    const history = (
      await w.h.inject({ method: 'GET', url: '/api/power/history', cookie })
    ).json<PowerHistory>();
    const o = history.occurrences[0]!;
    expect(o.counts).toMatchObject({ done: 1, excluded: 2 });
    expect(o.devices.map((d) => [d.name, d.result, d.excludedReason ?? null])).toEqual([
      ['LAB3-PC01', 'done', null],
      ['LAB3-PC02', 'excluded', 'never_flag'],
      ['LAB3-PROF', 'excluded', 'excluded_tag'],
    ]);
  });
});

describe('saving a schedule never shuts machines down at once (FR-602, ADR-058)', () => {
  const create = (s: AgentWorld['h']['services'], roomId: number) =>
    s.schedules.create(
      {
        name: 'Desligar Lab 3',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [roomId] },
        action: 'shutdown',
      },
      ACTOR,
    );

  it('AC-602-01: saved at 06:31 for 06:30 → no order and no agenda item today; tomorrow normal', async () => {
    const { w, s, room, agents } = await lab();
    w.h.clock.set(AT_0630 + MIN);
    create(s, room.id);
    s.scheduler.tick();
    expect(s.db.all('SELECT id FROM power_jobs')).toEqual([]);
    expect(s.db.all('SELECT id FROM schedule_runs')).toEqual([]);
    await agents[0]!.checkin();
    const items = agents[0]!.agenda!.items.map((i) => i.at);
    expect(items).not.toContain(AT_0630);
    expect(items[0]).toBe(AT_0630 + 86_400_000);
    // Tomorrow's 06:30 is pushed as usual.
    w.h.clock.set(AT_0630 + 86_400_000 - 6 * MIN);
    s.scheduler.tick();
    expect(s.db.all<{ uuid: string }>('SELECT uuid FROM power_jobs')).toHaveLength(1);
  });

  it('AC-602-01: an edit after T also leaves T out (it was handled before the edit)', async () => {
    const { w, s, room, agents } = await lab();
    const id = create(s, room.id).id;
    w.h.clock.set(AT_0630 + 2 * MIN);
    s.schedules.update(id, { name: 'Desligar Lab 3 (noite)' }, ACTOR);
    await agents[0]!.checkin();
    expect(agents[0]!.agenda!.items.map((i) => i.at)).not.toContain(AT_0630);
  });

  it('AC-602-02: saved before T with the hub off from T − 10 to T + 10 → pushed late, as before', async () => {
    const { w, s, room } = await lab();
    create(s, room.id); // saved at 06:00
    w.h.clock.set(AT_0630 + 10 * MIN); // the hub comes back at 06:40
    s.scheduler.tick();
    expect(s.db.all('SELECT id FROM power_jobs')).toHaveLength(1);
    expect(s.db.get<{ status: string }>('SELECT status FROM schedule_runs')!.status).toBe(
      'atrasado',
    );
  });
});
