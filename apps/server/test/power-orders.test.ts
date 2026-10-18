/**
 * M17-T03 (FR-305, owner Q-1/Q-7): manual "Desligar" / "Reiniciar" — preview, orders, the extra
 * confirmation for protected machines, live states from reports and the monitor, cancel.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WAS_OFF_ORDER_DETAIL, type PowerJob, type PowerPreview } from '@uniwake/shared';
import { deviceState } from '../src/application/power/power-orders';
import { changeLog } from '../src/db/sync/change-log';
import { apiHarness, type ApiHarness } from './helpers/api';
import { relogPower } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const MIN = 60_000;

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
  const cookie = await h.as('operator');
  const s = h.services;
  const room = s.rooms.create({ name: 'Lab 3' }, ACTOR).id;
  const ids: number[] = [];
  for (let i = 1; i <= 12; i++) {
    ids.push(
      s.devices.create(
        {
          name: `PC-${String(i).padStart(2, '0')}`,
          mac: `00:AA:00:00:00:${String(i).padStart(2, '0')}`,
          roomId: room,
        },
        ACTOR,
      ).device.id,
    );
  }
  // PC-01..10 prepared with v1.3; PC-11 and PC-12 only with v1.2. PC-01..03 have a user logged on.
  for (const [i, id] of ids.slice(0, 10).entries()) {
    s.db.run(
      'INSERT INTO device_agents (device_id, token_hash, issued_at, rotated_at) VALUES (?, ?, 1, 1)',
      [id, `hash-${id}`],
    );
    s.db.run(
      'INSERT INTO agent_seen (device_id, seen_at, user_logged_on, session_count) VALUES (?, 1, ?, ?)',
      [id, i < 3 ? 1 : 0, i < 3 ? 1 : 0],
    );
  }
  const call = async <T>(method: 'POST' | 'GET', url: string, payload?: object) => {
    const r = await h.inject({ method, url, cookie, payload });
    return { status: r.statusCode, body: r.json<T>() };
  };
  const target = { type: 'rooms', roomIds: [room], includeNoRoom: false } as const;
  return { h, s, room, ids, call, target };
}

const orders = (h: ApiHarness) =>
  h.services.db.all<{
    device_id: number;
    warning_minutes: number;
    allow_postpone: number;
    state: string;
  }>(
    'SELECT device_id, warning_minutes, allow_postpone, state FROM power_orders ORDER BY device_id',
  );

describe('manual shutdown (FR-305)', () => {
  it('AC-305-01: preview counts ready, v1.2 and logged-on machines; only ready ones get orders, 1 min without postpone', async () => {
    const { h, call, target } = await setup();
    const p = await call<PowerPreview>('POST', '/api/power/preview', {
      action: 'shutdown',
      target,
    });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ count: 10, withUser: 3, needsConfirmation: false });
    expect(p.body.needsPreparation.map((d) => d.name)).toEqual(['PC-11', 'PC-12']);
    // The room breakdown counts only the machines that receive the order (E2E found 12 here).
    expect(p.body.rooms).toEqual([{ roomId: expect.any(Number), name: 'Lab 3', count: 10 }]);
    expect(p.body.policy).toEqual({
      warningMinutes: 1,
      allowPostpone: false,
      postponeMax: 0,
      postponeMinutes: 5,
    });

    const started = await call<{ jobId: number; count: number }>('POST', '/api/power/jobs', {
      action: 'shutdown',
      target,
    });
    expect(started.status).toBe(202);
    expect(started.body.count).toBe(10);
    expect(orders(h)).toHaveLength(10);
    expect(
      orders(h).every(
        (o) => o.warning_minutes === 1 && o.allow_postpone === 0 && o.state === 'pending',
      ),
    ).toBe(true);
    const job = await call<PowerJob>('GET', `/api/power/jobs/${started.body.jobId}`);
    expect(job.body.counts.pending).toBe(10);
    expect(job.body.label).toBe('sala Lab 3');
    expect(h.services.audit.query({ action: 'power.shutdown' }).total).toBe(1);
  });

  it('"5 min com adiamento" uses the schedules\' defaults from the settings', async () => {
    const { s, call, target } = await setup();
    s.settings.update({ 'power.postponeMax': 3, 'power.postponeMinutes': 10 }, null);
    const p = await call<PowerPreview>('POST', '/api/power/preview', {
      action: 'restart',
      target,
      warning: 'standard',
    });
    expect(p.body.policy).toEqual({
      warningMinutes: 5,
      allowPostpone: true,
      postponeMax: 3,
      postponeMinutes: 10,
    });
  });

  it('AC-305-04: a machine flagged "Nunca desligar por agendamento" is named and needs an explicit confirmation', async () => {
    const { h, s, ids, call, target } = await setup();
    s.db.run('UPDATE devices SET never_scheduled_shutdown = 1 WHERE id = ?', [ids[4]!]);
    changeLog(s.db).touch('device', ids[4]!); // as the device form will (M19-T03)
    const p = await call<PowerPreview>('POST', '/api/power/preview', {
      action: 'shutdown',
      target,
    });
    expect(p.body.protected.map((d) => d.name)).toEqual(['PC-05']);
    const refused = await call<{ code: string; details: { devices: { name: string }[] } }>(
      'POST',
      '/api/power/jobs',
      { action: 'shutdown', target },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('POWER_PROTECTED_CONFIRMATION');
    expect(refused.body.details.devices.map((d) => d.name)).toEqual(['PC-05']);
    expect(orders(h)).toHaveLength(0);
    const ok = await call('POST', '/api/power/jobs', {
      action: 'shutdown',
      target,
      confirmProtected: true,
    });
    expect(ok.status).toBe(202);
    expect(orders(h)).toHaveLength(10);
  });

  it('large targets need the exact count (SR-10); empty and unprepared targets are refused', async () => {
    const { s, call } = await setup();
    const all = await call<{ code: string }>('POST', '/api/power/jobs', {
      action: 'shutdown',
      target: { type: 'all' },
    });
    expect(all.status).toBe(409);
    expect(all.body.code).toBe('CONFIRMATION_REQUIRED');
    expect(
      (
        await call('POST', '/api/power/jobs', {
          action: 'shutdown',
          target: { type: 'all' },
          confirm: { count: 10 },
        })
      ).status,
    ).toBe(202);
    const empty = s.rooms.create({ name: 'Vazia' }, ACTOR).id;
    expect(
      (
        await call<{ code: string }>('POST', '/api/power/jobs', {
          action: 'shutdown',
          target: { type: 'rooms', roomIds: [empty], includeNoRoom: false },
        })
      ).body.code,
    ).toBe('POWER_TARGET_EMPTY');
    const old = s.devices.create({ name: 'VELHO', mac: '00:BB:00:00:00:01', roomId: empty }, ACTOR)
      .device.id;
    expect(
      (
        await call<{ code: string }>('POST', '/api/power/jobs', {
          action: 'shutdown',
          target: { type: 'devices', deviceIds: [old] },
        })
      ).body.code,
    ).toBe('POWER_NOT_READY');
  });

  it('AC-305-02: executed + offline = desligou; still online 5 min later = não confirmou', async () => {
    const { h, s, ids, call, target } = await setup();
    const { body } = await call<{ jobId: number }>('POST', '/api/power/jobs', {
      action: 'shutdown',
      target,
    });
    const now = h.clock.now();
    s.db.run(
      "UPDATE power_orders SET state = 'executed', executed_at = ? WHERE device_id IN (?, ?)",
      [now, ids[0]!, ids[1]!],
    );
    s.db.run("UPDATE device_state SET status = 'offline' WHERE device_id = ?", [ids[0]!]);
    s.db.run("UPDATE device_state SET status = 'online', online_since = ? WHERE device_id = ?", [
      now - 3_600_000,
      ids[1]!,
    ]);
    s.db.run("UPDATE power_orders SET state = 'delivered' WHERE device_id = ?", [ids[2]!]);
    const at = async () =>
      (await call<PowerJob>('GET', `/api/power/jobs/${body.jobId}`)).body.devices;
    const state = (list: PowerJob['devices'], name: string) =>
      list.find((d) => d.name === name)!.state;
    let list = await at();
    expect([
      state(list, 'PC-01'),
      state(list, 'PC-02'),
      state(list, 'PC-03'),
      state(list, 'PC-04'),
    ]).toEqual(['done', 'confirming', 'received', 'pending']);
    h.clock.set(now + 6 * MIN);
    list = await at();
    expect(state(list, 'PC-02')).toBe('not_confirmed');
  });

  it('a restart is confirmed when the machine comes back online after the order', () => {
    const at = 1_000_000;
    expect(
      deviceState(
        'restart',
        { state: 'executed', executedAt: at, status: 'online', onlineSince: at + MIN },
        at + 2 * MIN,
      ),
    ).toBe('done');
    expect(
      deviceState(
        'restart',
        { state: 'executed', executedAt: at, status: 'offline', onlineSince: null },
        at + 2 * MIN,
      ),
    ).toBe('confirming');
    expect(
      deviceState(
        'restart',
        { state: 'executed', executedAt: at, status: 'online', onlineSince: at - MIN },
        at + 11 * MIN,
      ),
    ).toBe('not_confirmed');
    expect(
      deviceState(
        'shutdown',
        { state: 'executed', executedAt: at, status: 'online', onlineSince: at + MIN },
        at + 9 * MIN,
      ),
    ).toBe('done');
  });

  it('a machine that skipped the order because it was off shows "was_off", not "failed"', () => {
    const row = { state: 'failed', executedAt: 1, status: 'online', onlineSince: 2 } as const;
    expect(deviceState('shutdown', { ...row, detail: WAS_OFF_ORDER_DETAIL }, 10)).toBe('was_off');
    expect(deviceState('restart', { ...row, detail: WAS_OFF_ORDER_DETAIL }, 10)).toBe('was_off');
    expect(deviceState('shutdown', { ...row, detail: 'erro do Windows' }, 10)).toBe('failed');
    expect(deviceState('shutdown', row, 10)).toBe('failed');
  });

  it('"Cancelar" cancels what has not run, is audited and tells the panel', async () => {
    const { h, s, ids, call, target } = await setup();
    const events: string[] = [];
    s.events.subscribe((e) => events.push(e.type));
    const { body } = await call<{ jobId: number }>('POST', '/api/power/jobs', {
      action: 'shutdown',
      target,
    });
    s.db.run("UPDATE power_orders SET state = 'executed', executed_at = 1 WHERE device_id = ?", [
      ids[0]!,
    ]);
    s.db.run("UPDATE power_orders SET state = 'delivered' WHERE device_id = ?", [ids[1]!]);
    const after = await call<PowerJob>('POST', `/api/power/jobs/${body.jobId}/cancel`);
    expect(after.status).toBe(200);
    expect(after.body.counts.cancelled).toBe(9);
    expect(orders(h).find((o) => o.device_id === ids[0])!.state).toBe('executed');
    expect(h.services.audit.query({ action: 'power.cancel' }).total).toBe(1);
    expect(events.filter((t) => t === 'power.job')).toHaveLength(2);
    expect((await call<{ code: string }>('GET', '/api/power/jobs/999')).body.code).toBe(
      'POWER_JOB_NOT_FOUND',
    );
  });
});
