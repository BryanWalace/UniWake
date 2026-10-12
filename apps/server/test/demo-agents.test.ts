/**
 * M19-T05 (FR-310): simulated agents in demo mode — ready machines run orders and agenda items,
 * one postpones twice, v1.2 machines get no agent, a frozen one goes silent and becomes "perdido".
 * Nothing leaves the process: "shutting down" only flips the simulated power.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DemoAgentsService, demoBehaviour } from '../src/application/demo/demo-agents';
import { SqliteDemoAgentStore } from '../src/db/repositories/power-repo';
import { changeLog } from '../src/db/sync/change-log';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const MIN = 60_000;

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  const s = h.services;
  const room = s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
  const add = (name: string, n: number) =>
    s.devices.create({ name, mac: `00:AA:00:00:00:0${n}`, roomId: room }, ACTOR).device.id;
  const ids = {
    ready: add('LAB1-PC01', 1),
    postponer: add('LAB1-ADIA', 2),
    old: add('LAB1-V12', 3),
    frozen: add('LAB1-CONGELADA', 4),
  };
  const power: { mac: string; on: boolean; at: number }[] = [];
  const demo = new DemoAgentsService({
    store: new SqliteDemoAgentStore(s.db),
    agenda: (id) => s.agenda.forDevice(id),
    setPower: (mac, on) => power.push({ mac, on, at: h.clock.now() }),
    events: s.events,
    clock: h.clock,
    instanceId: () => changeLog(s.db).instanceId(),
  });
  return { h, s, room, ids, power, demo };
}

describe('demo agents (FR-310)', () => {
  it('AC-310-01: every case is present and nothing real is sent', async () => {
    const { h, s, room, ids, power, demo } = await setup();
    demo.tick();
    const agents = s.powerStatus.list();
    const state = (id: number) => agents.find((a) => a.deviceId === id)!.readiness;
    expect(state(ids.ready)).toBe('ready');
    expect(state(ids.old)).toBe('needs_preparation');
    expect(agents.find((a) => a.deviceId === ids.frozen)!.freezeState).toBe('frozen');

    // The frozen PC answers ping without interruption but never checks in → "perdido".
    s.db.run("UPDATE device_state SET status = 'online', online_since = ? WHERE device_id = ?", [
      h.clock.now() - 20 * MIN,
      ids.frozen,
    ]);
    expect(s.powerStatus.device(ids.frozen).readiness).toBe('lost');

    // A manual shutdown with postpone allowed: received, then done; the "ADIA" one postpones twice.
    const job = s.power.start(
      {
        action: 'shutdown',
        target: { type: 'rooms', roomIds: [room], includeNoRoom: false },
        warning: 'standard',
        confirmProtected: false,
      },
      ACTOR,
    );
    h.clock.set(h.clock.now() + 1000);
    demo.tick();
    expect(s.power.get(job.jobId).counts.received).toBe(2);
    h.clock.set(h.clock.now() + 3000);
    demo.tick();
    const mid = s.power.get(job.jobId).devices;
    expect(mid.find((d) => d.deviceId === ids.ready)!.state).toBe('done'); // offline in the sim
    expect(mid.find((d) => d.deviceId === ids.postponer)!.state).toBe('received');
    h.clock.set(h.clock.now() + 4000);
    demo.tick();
    const end = s.power.get(job.jobId).devices;
    expect(end.find((d) => d.deviceId === ids.postponer)!.postpones).toBe(2);
    // Only the simulated power changed: the two machines that received the order went off.
    expect(
      power
        .filter((p) => !p.on)
        .map((p) => p.mac)
        .sort(),
    ).toEqual(['00:AA:00:00:00:01', '00:AA:00:00:00:02']);
  });

  it('runs agenda items at their time in the simulated network', async () => {
    const { h, s, room, power, demo } = await setup();
    const sched = s.schedules.create(
      {
        name: 'Desligar',
        weekdays: 127,
        timeLocal: '22:40',
        target: { type: 'rooms', roomIds: [room] },
        action: 'shutdown',
      },
      ACTOR,
    );
    const next = s.agenda.forDevice(1)!.items[0]!.at;
    h.clock.set(next - 5000);
    demo.tick();
    h.clock.set(next + 1000);
    demo.tick();
    expect(power.filter((p) => !p.on && p.at === next + 1000).length).toBe(2); // ready + postponer
    expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM power_reports')!.n).toBe(2);
    expect(sched.action).toBe('shutdown');
  });

  it('picks behaviours by name, including the seeded demo machines', () => {
    expect(demoBehaviour('LAB2-PC03')).toBe('postpone');
    expect(demoBehaviour('LAB3-PC05')).toBe('v12');
    expect(demoBehaviour('BIB-PC02')).toBe('frozen');
    expect(demoBehaviour('lab1-pc01')).toBe('ready');
  });
});
