/**
 * v1.6.0 (spec §6e, FR-605.2, ADR-061): "Acordar para desligar" — ready machines that do not answer
 * but checked in during the last 12 hours get a magic packet when a shutdown is sent (manual or
 * pushed); online and long-silent ones get none; the setting turns it off. The fake sender only
 * records packets: nothing leaves the process.
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

async function lab(wakeForShutdown = true) {
  const w = await agentWorld();
  worlds.push(w);
  const s = w.h.services;
  const room = s.rooms.create({ name: 'Lab 4' }, ACTOR);
  const dev = (name: string, mac: string) =>
    s.devices.create({ name, mac, roomId: room.id }, ACTOR).device.id;
  const on = dev('LAB4-PC01', '00:AA:00:00:00:41');
  const asleep = dev('LAB4-PC02', '00:AA:00:00:00:42');
  const silent = dev('LAB4-PC03', '00:AA:00:00:00:43');
  // The third one last talked to the hub two days ago (stored away, not asleep).
  w.h.clock.set(T0 - 2 * 86_400_000);
  await w.agent(silent).checkin();
  w.h.clock.set(T0);
  for (const id of [on, asleep]) await w.agent(id).checkin();
  s.db.run("UPDATE device_state SET status = 'online', online_since = ? WHERE device_id = ?", [
    w.h.clock.now(),
    on,
  ]);
  s.db.run(
    "UPDATE device_state SET status = 'offline', online_since = NULL WHERE device_id IN (?, ?)",
    [asleep, silent],
  );
  const woken = () =>
    s.db
      .all<{ device_id: number }>(
        "SELECT d.device_id FROM wake_job_devices d JOIN wake_jobs j ON j.id = d.job_id WHERE j.source = 'manual' ORDER BY d.device_id",
      )
      .map((r) => r.device_id);
  // Opt-in since 2026-10-18 (owner): it also turns on machines that were really off.
  if (wakeForShutdown) s.settings.update({ 'power.wakeForShutdown': true }, null);
  return { w, s, room, on, asleep, silent, woken, cookie: await w.h.as('operator') };
}

describe('"Acordar para desligar" (FR-605.2)', () => {
  it('off by default (owner, 2026-10-18): a shutdown never turns machines on', async () => {
    const { w, s, room, woken, cookie } = await lab(false);
    expect(s.settings.get('power.wakeForShutdown')).toBe(false);
    await w.h.inject({
      method: 'POST',
      url: '/api/power/jobs',
      cookie,
      payload: { action: 'shutdown', target: { type: 'rooms', roomIds: [room.id] } },
    });
    expect(woken()).toEqual([]);
  });

  it('AC-605-02: a manual "Desligar" wakes only the ready machine that is probably asleep', async () => {
    const { w, room, asleep, woken, cookie } = await lab();
    const preview = await w.h.inject({
      method: 'POST',
      url: '/api/power/preview',
      cookie,
      payload: { action: 'shutdown', target: { type: 'rooms', roomIds: [room.id] } },
    });
    expect(preview.json<{ offline: number; asleep: number }>()).toMatchObject({
      offline: 2,
      asleep: 1,
    });
    const r = await w.h.inject({
      method: 'POST',
      url: '/api/power/jobs',
      cookie,
      payload: { action: 'shutdown', target: { type: 'rooms', roomIds: [room.id] } },
    });
    expect(r.statusCode).toBe(202);
    expect(woken()).toEqual([asleep]);
  });

  it('AC-605-02: a pushed scheduled shutdown does the same; the setting off sends nothing', async () => {
    const { w, s, room, asleep, woken } = await lab();
    s.schedules.create(
      {
        name: 'Desligar Lab 4',
        weekdays: 127,
        timeLocal: '06:30',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    );
    w.h.clock.set(T0 + 24 * MIN);
    s.scheduler.tick();
    expect(woken()).toEqual([asleep]);

    s.settings.update({ 'power.wakeForShutdown': false }, null);
    s.schedules.create(
      {
        name: 'Desligar Lab 4 de novo',
        weekdays: 127,
        timeLocal: '06:40',
        target: { type: 'rooms', roomIds: [room.id] },
        action: 'shutdown',
      },
      ACTOR,
    );
    w.h.clock.set(T0 + 34 * MIN);
    s.scheduler.tick();
    expect(s.db.all('SELECT id FROM power_jobs')).toHaveLength(2);
    expect(woken()).toEqual([asleep]); // nothing more
  });

  it('a restart never wakes machines (only shutdowns do)', async () => {
    const { w, room, woken, cookie } = await lab();
    await w.h.inject({
      method: 'POST',
      url: '/api/power/jobs',
      cookie,
      payload: { action: 'restart', target: { type: 'rooms', roomIds: [room.id] } },
    });
    expect(woken()).toEqual([]);
  });
});
