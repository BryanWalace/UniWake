/**
 * v1.6.0 (spec §6e, FR-601/602, ADR-058): excluded machines are never hidden, and saving a
 * "Desligar" schedule never shuts machines down at once. Fake agents only: nothing is shut down.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PowerPreview } from '@uniwake/shared';
import { agentWorld, type AgentWorld } from './helpers/fake-agent';

const ACTOR = { id: null, label: 'teste' };
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
