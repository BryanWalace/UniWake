/**
 * M17-T05 (FR-307, FR-308.3, FR-309, owner Q-5/Q-6): readiness, the "perdido" rule, the health
 * count, agent details, revocation and the history aggregated per occurrence.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceAgentInfo, PowerHistory, PowerPreview } from '@uniwake/shared';
import { agentReadiness } from '../src/domain/readiness';
import { changeLog } from '../src/db/sync/change-log';
import { scheduleRunUuid } from '../src/db/sync/uuid';
import { apiHarness, type ApiHarness } from './helpers/api';
import { relogPower } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const MIN = 60_000;
const sp = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h + 3, m);

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) {
    relogPower(h.services.db); // rows set up with raw SQL (ADR-048 logging)
    await h.close();
  }
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  h.clock.set(sp(13, 9));
  const cookie = await h.as('admin');
  const s = h.services;
  const room = s.rooms.create({ name: 'Lab 3' }, ACTOR).id;
  const dev = (name: string, n: number) =>
    s.devices.create({ name, mac: `00:AA:00:00:00:0${n}`, roomId: room }, ACTOR).device.id;
  const ready = dev('PRONTA', 1);
  const old = dev('V12', 2);
  const lost = dev('PERDIDA', 3);
  const revoked = dev('REVOGADA', 4);
  const now = h.clock.now();
  for (const id of [ready, lost, revoked]) {
    s.db.run(
      'INSERT INTO device_agents (device_id, token_hash, issued_at, rotated_at) VALUES (?, ?, 1, 1)',
      [id, `hash-${id}`],
    );
  }
  s.db.run('UPDATE device_agents SET revoked_at = 5 WHERE device_id = ?', [revoked]);
  // Online for 20 minutes without interruption; checked in before that (or never).
  s.db.run(
    "UPDATE device_state SET status = 'online', online_since = ? WHERE device_id IN (?, ?)",
    [now - 20 * MIN, ready, lost],
  );
  s.db.run('INSERT INTO agent_seen (device_id, seen_at, boot_time) VALUES (?, ?, ?)', [
    ready,
    now - MIN,
    now - 20 * MIN,
  ]);
  s.db.run('INSERT INTO agent_seen (device_id, seen_at) VALUES (?, ?)', [lost, now - 30 * MIN]);
  const call = async <T>(method: 'GET' | 'POST', url: string, payload?: object) => {
    const r = await h.inject({ method, url, cookie, payload });
    return { status: r.statusCode, body: r.json<T>() };
  };
  return { h, s, room, ready, old, lost, revoked, call };
}

describe('readiness (FR-309, FR-308.3)', () => {
  it('AC-309-01: ready, v1.2, lost and revoked machines show their state; only ready ones get orders', async () => {
    const { s, room, ready, old, lost, revoked, call } = await setup();
    const list = (await call<DeviceAgentInfo[]>('GET', '/api/power/agents')).body;
    const state = (id: number) => list.find((a) => a.deviceId === id)!.readiness;
    expect([state(ready), state(old), state(lost), state(revoked)]).toEqual([
      'ready',
      'needs_preparation',
      'lost',
      'revoked',
    ]);
    const target = { type: 'rooms', roomIds: [room], includeNoRoom: false };
    const p = (
      await call<PowerPreview>('POST', '/api/power/preview', { action: 'shutdown', target })
    ).body;
    expect(p.count).toBe(1);
    expect(p.lost.map((d) => d.name)).toEqual(['PERDIDA']);
    expect(p.revoked.map((d) => d.name)).toEqual(['REVOGADA']);
    expect(p.needsPreparation.map((d) => d.name)).toEqual(['V12']);
    await call('POST', '/api/power/jobs', { action: 'shutdown', target });
    expect(s.db.all('SELECT device_id FROM power_orders')).toEqual([{ device_id: ready }]);
  });

  it('AC-308-03: online 20 min without a check-in = perdido (counted on Saúde do sistema); a check-in clears it', async () => {
    const { h, s, lost, call } = await setup();
    const health = s.health.details();
    expect(health.power).toEqual({ ready: 1, needsPreparation: 1, revoked: 1, lost: 1 });
    expect(health.warnings.find((w) => w.code === 'remote_shutdown_lost')?.message).toMatch(
      /1 máquina está com "Desligamento remoto perdido"/,
    );
    s.db.run('UPDATE agent_seen SET seen_at = ? WHERE device_id = ?', [h.clock.now(), lost]);
    expect((await call<DeviceAgentInfo>('GET', `/api/devices/${lost}/agent`)).body.readiness).toBe(
      'ready',
    );
    expect(s.health.details().warnings.some((w) => w.code === 'remote_shutdown_lost')).toBe(false);
  });

  it('a PC that came online 10 min ago is not "perdido" yet (no false alarm right after booting)', () => {
    const now = 100 * MIN;
    const base = { hasToken: true, revoked: false, online: true, lastCheckin: 10 * MIN };
    expect(agentReadiness({ ...base, onlineSince: now - 10 * MIN }, now)).toBe('ready');
    expect(agentReadiness({ ...base, onlineSince: now - 15 * MIN }, now)).toBe('lost');
    expect(agentReadiness({ ...base, online: false, onlineSince: null }, now)).toBe('ready');
    expect(
      agentReadiness({ ...base, onlineSince: now - 20 * MIN, lastCheckin: now - MIN }, now),
    ).toBe('ready');
  });

  it('device details carry freezing, sleep and session counts, never user names; revoking is audited', async () => {
    const { s, ready, call } = await setup();
    s.db.run(
      `UPDATE device_agents SET freeze_product = 'deep_freeze', freeze_state = 'thawed', sleep_after_minutes = 30,
         wake_timers = 'enabled', agent_version = '1.3.0' WHERE device_id = ?`,
      [ready],
    );
    s.db.run('UPDATE agent_seen SET user_logged_on = 1, session_count = 2 WHERE device_id = ?', [
      ready,
    ]);
    const info = (await call<DeviceAgentInfo>('GET', `/api/devices/${ready}/agent`)).body;
    expect(info).toMatchObject({
      readiness: 'ready',
      freezeProduct: 'deep_freeze',
      freezeState: 'thawed',
      sleepAfterMinutes: 30,
      wakeTimers: 'enabled',
      userLoggedOn: true,
      sessions: 2,
    });
    expect(JSON.stringify(info)).not.toMatch(/user(Name)?":"/);
    const after = await call<DeviceAgentInfo>('POST', `/api/devices/${ready}/agent/revoke`);
    expect(after.body.readiness).toBe('revoked');
    expect(s.audit.query({ action: 'agent.revoke' }).items[0]!.target).toBe('device:PRONTA');
  });
});

describe('history per occurrence (FR-307)', () => {
  it('AC-307-01: reports arriving over several check-ins become one row aggregated by outcome', async () => {
    const { h, s, room, ready, lost } = await setup();
    const sched = s.schedules.create(
      {
        name: 'Desligar 22:40',
        weekdays: 31,
        timeLocal: '22:40',
        target: { type: 'rooms', roomIds: [room] },
      },
      ACTOR,
    ).id;
    s.db.run(
      "UPDATE schedules SET action = 'shutdown', warning_minutes = 5, allow_postpone = 1, postpone_max = 2, postpone_minutes = 15 WHERE id = ?",
      [sched],
    );
    changeLog(s.db).touch('schedule', sched);
    const uuid = changeLog(s.db).uuidOf('schedule', sched)!;
    const at = sp(12, 22, 40);
    const occ = scheduleRunUuid(uuid, at);
    const extra = s.devices.create({ name: 'OUTRA', mac: '00:AA:00:00:00:09', roomId: room }, ACTOR)
      .device.id;
    const late = s.devices.create({ name: 'TARDE', mac: '00:AA:00:00:00:08', roomId: room }, ACTOR)
      .device.id;
    for (const id of [extra, late]) {
      s.db.run(
        'INSERT INTO device_agents (device_id, token_hash, issued_at, rotated_at) VALUES (?, ?, 1, 1)',
        [id, `h-${id}`],
      );
    }
    const report = (n: number, deviceId: number, over: Record<string, unknown>) => {
      const row = {
        uuid: `a1b2c3d4-0000-4000-8000-00000000000${n}`,
        device_id: deviceId,
        occurrence_uuid: occ,
        action: 'shutdown',
        outcome: 'done',
        planned_at: at,
        postpones: 0,
        received_at: h.clock.now() + n * MIN, // arrive at different check-ins
        ...over,
      };
      const cols = Object.keys(row);
      s.db.run(
        `INSERT INTO power_reports (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        Object.values(row),
      );
    };
    report(1, ready, { postpones: 2, executed_at: at + 30 * MIN });
    report(2, extra, { outcome: 'skipped', reason: 'was_off' });
    report(3, late, { outcome: 'skipped', reason: 'late_wake', late_minutes: 70, was_asleep: 1 });
    // PERDIDA sent nothing, but its next check-in shows a boot after 22:40 (a frozen PC lost it).
    s.db.run('UPDATE agent_seen SET boot_time = ? WHERE device_id = ?', [at + 9 * 60 * MIN, lost]);

    const history = (
      await h.inject({ url: '/api/power/history', cookie: await h.as('operator') })
    ).json<PowerHistory>();
    expect(history.occurrences).toHaveLength(1);
    const row = history.occurrences[0]!;
    expect(row).toMatchObject({ scheduleName: 'Desligar 22:40', plannedAt: at, maxPostpones: 2 });
    expect(row.counts).toMatchObject({
      done: 1,
      postponed: 1,
      was_off: 1,
      late_wake: 1,
      probably_done: 1,
    });
    expect(row.devices.find((d) => d.name === 'TARDE')).toMatchObject({
      lateMinutes: 70,
      wasAsleep: true,
    });
  });
});
