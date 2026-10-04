import { afterEach, describe, expect, it } from 'vitest';
import type { WakeJob, WakeJobDevice } from '@uniwake/shared';
import { createServices } from '../src/services';
import { errnoError } from './fakes/faults';
import { iface } from './fakes/network-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) {
    await drive(h, 3_600_000);
    await h.close();
  }
});

/** Advances fake time until the runner has no job left (or `maxMs` passes). */
async function drive(h: ApiHarness, maxMs = 15 * 60_000, stepMs = 1000) {
  for (let t = 0; t < maxMs && h.services.runner.activeCount > 0; t += stepMs) {
    await h.clock.advanceAsync(stepMs);
  }
}

interface World {
  h: ApiHarness;
  cookie: string;
  roomA: number;
  roomB: number;
  A: { id: number; mac: string; ip: string }[];
  B: { id: number; mac: string; ip: string }[];
}

async function world(): Promise<World> {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const roomA = h.services.rooms.create({ name: 'Lab A' }, ACTOR).id;
  const roomB = h.services.rooms.create(
    { name: 'Lab B', directedBroadcast: '10.0.7.255' },
    ACTOR,
  ).id;
  const mk = (roomId: number, i: number) => {
    const mac = `00:AA:00:00:0${roomId}:${(i + 1).toString(16).padStart(2, '0')}`;
    const d = h.services.devices.create(
      { name: `PC-${roomId}-${i}`, mac, roomId, ip: `10.0.3.${roomId * 10 + i}` },
      ACTOR,
    );
    return { id: d.device.id, mac: d.device.mac, ip: d.device.ip! };
  };
  const A = [0, 1, 2].map((i) => mk(roomA, i));
  const B = [0, 1].map((i) => mk(roomB, i));
  return { h, cookie, roomA, roomB, A, B };
}

const wake = (w: World, body: object) =>
  w.h.inject({ method: 'POST', url: '/api/wake', cookie: w.cookie, payload: body });
const job = async (w: World, id: number) =>
  (await w.h.inject({ url: `/api/jobs/${id}`, cookie: w.cookie })).json<{
    job: WakeJob;
    devices: WakeJobDevice[];
  }>();
const roomTarget = (ids: number[]) => ({ target: { type: 'rooms', roomIds: ids } });

describe('wake engine end to end (FR-003)', () => {
  it('AC-003-05 waking room A sends magic packets for exactly room A and zero for room B', async () => {
    const w = await world();
    const r = await wake(w, roomTarget([w.roomA]));
    expect(r.statusCode).toBe(202);
    await drive(w.h);
    expect([...w.h.ports.sender.macsSent()].sort()).toEqual(w.A.map((d) => d.mac).sort());
    for (const b of w.B) expect(w.h.ports.sender.macsSent().has(b.mac)).toBe(false);
  });

  it('AC-003-02 / AC-003-12 every device gets limited + subnet broadcast on ports 9 and 7, 3 repeats, all logged', async () => {
    const w = await world();
    const { jobId } = (
      await wake(w, { target: { type: 'devices', deviceIds: [w.A[0]!.id] } })
    ).json<{ jobId: number }>();
    await drive(w.h);
    const sent = w.h.ports.sender.sent;
    expect(sent).toHaveLength(2 * 2 * 3);
    expect(new Set(sent.map((p) => `${p.sourceIp}>${p.destination}:${p.port}`))).toEqual(
      new Set([
        '10.0.3.15>255.255.255.255:9',
        '10.0.3.15>255.255.255.255:7',
        '10.0.3.15>10.0.3.255:9',
        '10.0.3.15>10.0.3.255:7',
      ]),
    );
    const packets = (
      await w.h.inject({ url: `/api/jobs/${jobId}/packets`, cookie: w.cookie })
    ).json<{ repeat: number; outcome: string }[]>();
    expect(packets).toHaveLength(12);
    expect(packets.map((p) => p.repeat).sort()).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(packets.every((p) => p.outcome === 'sent')).toBe(true);
  });

  it('AC-003-03 the room directed broadcast is added for devices of that room', async () => {
    const w = await world();
    await wake(w, roomTarget([w.roomB]));
    await drive(w.h);
    expect(w.h.ports.sender.sent.some((p) => p.destination === '10.0.7.255')).toBe(true);
  });

  it('AC-003-11 a device that comes online after 90 s is "acordou"; others "não respondeu" at the end of the window', async () => {
    const w = await world();
    const { jobId } = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    const t0 = w.h.clock.now();
    await w.h.clock.advanceAsync(89_000);
    w.h.ports.prober.setAlive(w.A[0]!.ip);
    await drive(w.h);
    const { job: j, devices } = await job(w, jobId);
    expect(j.state).toBe('concluido');
    const woke = devices.find((d) => d.deviceId === w.A[0]!.id)!;
    expect(woke.result).toBe('acordou');
    expect((woke.wokeAt! - t0) / 1000).toBeGreaterThanOrEqual(89);
    expect((woke.wokeAt! - t0) / 1000).toBeLessThanOrEqual(106);
    expect(devices.filter((d) => d.result === 'nao_respondeu')).toHaveLength(2);
    expect(j.summary).toMatchObject({ total: 3, woke: 1, noResponse: 2 });
    expect(w.h.services.audit.query({ action: 'wake.finish' }).items[0]?.details).toMatchObject({
      jobId,
      woke: 1,
    });
  });

  it('devices online when the job starts are "já estava ligado"; devices without address are "sem IP"', async () => {
    const w = await world();
    w.h.services.db.run("UPDATE device_state SET status = 'online' WHERE device_id = ?", [
      w.A[0]!.id,
    ]);
    w.h.services.db.run('UPDATE devices SET ip = NULL WHERE id = ?', [w.A[1]!.id]);
    const { jobId } = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    await drive(w.h);
    const { devices } = await job(w, jobId);
    const result = (id: number) => devices.find((d) => d.deviceId === id)?.result;
    expect(result(w.A[0]!.id)).toBe('ja_estava_ligado');
    expect(result(w.A[1]!.id)).toBe('nao_verificado');
    expect(result(w.A[2]!.id)).toBe('nao_respondeu');
  });

  it('AC-003-10 stagger: batch 2 with 10 s delay sends at 0 and 10 s', async () => {
    const w = await world();
    w.h.services.rooms.update(w.roomA, { batchSize: 2, batchDelaySeconds: 10 }, ACTOR);
    const t0 = w.h.clock.now();
    await wake(w, roomTarget([w.roomA]));
    await drive(w.h);
    const firstSend = new Map<string, number>();
    for (const p of w.h.ports.sender.sent) {
      const mac = [...p.payload.slice(6, 12)]
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(':');
      if (!firstSend.has(mac)) firstSend.set(mac, p.at - t0);
    }
    expect(w.A.map((d) => firstSend.get(d.mac))).toEqual([0, 0, 10_000]);
  });

  it('AC-003-08 large actions need the exact count; preview tells it', async () => {
    const w = await world();
    w.h.services.settings.update({ 'wake.confirmThreshold': 2 }, null);
    const pv = await w.h.inject({
      method: 'POST',
      url: '/api/wake/preview',
      cookie: w.cookie,
      payload: roomTarget([w.roomA]),
    });
    expect(pv.json()).toMatchObject({
      count: 3,
      needsConfirmation: true,
      rooms: [{ name: 'Lab A', count: 3 }],
    });
    const noConfirm = await wake(w, roomTarget([w.roomA]));
    expect(noConfirm.statusCode).toBe(409);
    expect(noConfirm.json()).toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      details: { count: 3 },
    });
    expect((await wake(w, { ...roomTarget([w.roomA]), confirm: { count: 2 } })).statusCode).toBe(
      409,
    );
    expect(w.h.ports.sender.sent).toHaveLength(0); // nothing sent before the confirmed start
    expect((await wake(w, { ...roomTarget([w.roomA]), confirm: { count: 3 } })).statusCode).toBe(
      202,
    );
  });

  it('AC-003-15 preview and execution agree; if data changes in between, execution asks again', async () => {
    const w = await world();
    w.h.services.settings.update({ 'wake.confirmThreshold': 2 }, null);
    const pv = (
      await w.h.inject({
        method: 'POST',
        url: '/api/wake/preview',
        cookie: w.cookie,
        payload: roomTarget([w.roomA]),
      })
    ).json<{ count: number }>();
    w.h.services.devices.create({ name: 'Novo', mac: '00:AA:00:00:09:09', roomId: w.roomA }, ACTOR);
    const r = await wake(w, { ...roomTarget([w.roomA]), confirm: { count: pv.count } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'CONFIRMATION_REQUIRED', details: { count: 4 } });
  });

  it('AC-003-09 a device already in an active job is excluded; if all are, 409 WAKE_ALREADY_RUNNING', async () => {
    const w = await world();
    const first = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    await w.h.clock.advanceAsync(2000);
    const again = await wake(w, roomTarget([w.roomA]));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      code: 'WAKE_ALREADY_RUNNING',
      details: { jobIds: [first.jobId] },
    });
    const pv = (
      await w.h.inject({
        method: 'POST',
        url: '/api/wake/preview',
        cookie: w.cookie,
        payload: roomTarget([w.roomA, w.roomB]),
      })
    ).json<{
      count: number;
      excluded: { reason: string; jobId: number }[];
    }>();
    expect(pv.count).toBe(2);
    expect(pv.excluded).toHaveLength(3);
    expect(pv.excluded.every((e) => e.reason === 'in_active_job' && e.jobId === first.jobId)).toBe(
      true,
    );
  });

  it('AC-003-14 the 31st wake request in a minute is rate limited', async () => {
    const w = await world();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await wake(w, roomTarget([w.roomA]))).statusCode);
    expect(statuses[0]).toBe(202);
    expect(statuses.slice(1, 30).every((s) => s === 409)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('empty targets and unknown devices are rejected', async () => {
    const w = await world();
    const empty = w.h.services.rooms.create({ name: 'Vazia' }, ACTOR).id;
    const r = await wake(w, roomTarget([empty]));
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ code: 'WAKE_TARGET_EMPTY' });
    const unknown = await wake(w, { target: { type: 'devices', deviceIds: [9999] } });
    expect(unknown.json()).toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });

  it('AC-003-13 dry-run records packets but never calls the real sender', async () => {
    const w = await world();
    w.h.services.settings.update({ 'wake.dryRun': true }, null);
    const { jobId } = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    await drive(w.h);
    expect(w.h.ports.sender.sent).toHaveLength(0);
    expect(w.h.ports.dryRunSender.sent.length).toBeGreaterThan(0);
    const packets = (
      await w.h.inject({ url: `/api/jobs/${jobId}/packets`, cookie: w.cookie })
    ).json<{ outcome: string }[]>();
    expect(packets.every((p) => p.outcome === 'dry_run')).toBe(true);
    expect((await job(w, jobId)).job.dryRun).toBe(true);
  });

  it('AC-003-04 a manual wake with no usable interface fails with NO_NETWORK_INTERFACE', async () => {
    const w = await world();
    w.h.ports.interfaces.interfaces = [];
    const { jobId } = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    await drive(w.h);
    const { job: j, devices } = await job(w, jobId);
    expect(j).toMatchObject({ state: 'falhou', error: 'NO_NETWORK_INTERFACE' });
    expect(devices.every((d) => d.result === 'falha_no_envio')).toBe(true);
  });

  it('AC-003-16 a scheduled wake retries every 30 s until an interface appears', async () => {
    const w = await world();
    w.h.ports.interfaces.interfaces = [];
    const t0 = w.h.clock.now();
    const { jobId } = w.h.services.wake.start(
      { target: { type: 'rooms', roomIds: [w.roomA], includeNoRoom: false }, onlyOffline: false },
      { id: null, label: 'agendamento' },
      { source: 'schedule', preConfirmed: true, networkRetryUntil: t0 + 15 * 60_000 },
    );
    await w.h.clock.advanceAsync(65_000);
    expect(w.h.ports.sender.sent).toHaveLength(0);
    w.h.ports.interfaces.interfaces = [iface({ address: '10.0.3.15', gateway: '10.0.3.1' })];
    await drive(w.h);
    expect(w.h.ports.sender.sent.length).toBeGreaterThan(0);
    expect(w.h.ports.sender.sent[0]!.at - t0).toBe(90_000);
    expect((await job(w, jobId)).job.state).toBe('concluido');
  });

  it('AC-003-16 a scheduled wake that never finds an interface fails at the end of the grace window', async () => {
    const w = await world();
    w.h.ports.interfaces.interfaces = [];
    const { jobId } = w.h.services.wake.start(
      { target: { type: 'rooms', roomIds: [w.roomA], includeNoRoom: false }, onlyOffline: false },
      { id: null, label: 'agendamento' },
      { source: 'schedule', preConfirmed: true, networkRetryUntil: w.h.clock.now() + 5 * 60_000 },
    );
    await drive(w.h);
    expect((await job(w, jobId)).job).toMatchObject({
      state: 'falhou',
      error: 'NO_NETWORK_INTERFACE',
    });
  });

  it('fault: one interface failing does not stop sends on the other', async () => {
    const w = await world();
    w.h.ports.interfaces.interfaces = [
      iface({ name: 'Ethernet', address: '10.0.3.15', gateway: '10.0.3.1' }),
      iface({ name: 'Ethernet 2', address: '10.0.4.20', prefixLength: 23, gateway: '10.0.4.1' }),
    ];
    w.h.ports.sender.faults.failWhen(
      (r) => r.sourceIp === '10.0.4.20',
      errnoError('EADDRNOTAVAIL'),
    );
    const { jobId } = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    await drive(w.h);
    const packets = (
      await w.h.inject({ url: `/api/jobs/${jobId}/packets`, cookie: w.cookie })
    ).json<{ outcome: string; error: string | null }[]>();
    expect(packets.some((p) => p.outcome === 'error' && p.error === 'EADDRNOTAVAIL')).toBe(true);
    expect((await job(w, jobId)).devices.every((d) => d.result !== 'falha_no_envio')).toBe(true);
  });

  it('fault: if every send fails, the device is "falha no envio"', async () => {
    const w = await world();
    w.h.ports.sender.faults.failWhen(() => true, errnoError('ENETDOWN'));
    const { jobId } = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    await drive(w.h);
    const { job: j, devices } = await job(w, jobId);
    expect(devices.every((d) => d.result === 'falha_no_envio')).toBe(true);
    expect(j.summary.sendFailed).toBe(3);
  });

  it('lists jobs and audits wake.start with the actor', async () => {
    const w = await world();
    await wake(w, roomTarget([w.roomA]));
    await drive(w.h);
    const list = (await w.h.inject({ url: '/api/jobs', cookie: w.cookie })).json<{
      items: WakeJob[];
      total: number;
    }>();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      targetLabel: 'sala Lab A',
      requestedBy: 'operator-user',
      source: 'manual',
    });
    expect(w.h.services.audit.query({ action: 'wake.start' }).items[0]).toMatchObject({
      actorLabel: 'operator-user',
      target: 'sala Lab A',
    });
  });
});

describe('restart recovery (AC-003-17)', () => {
  it('resumes verification after a restart if the window is still open', async () => {
    const w = await world();
    const { jobId } = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    await w.h.clock.advanceAsync(5000); // sent, now verifying
    expect((await job(w, jobId)).job.state).toBe('verificando');
    // "Restart": a second set of services over the same database recovers the job.
    const restarted = createServices(w.h.services.db, w.h.clock, w.h.ports);
    restarted.runner.recover();
    w.h.ports.prober.setAlive(w.A[0]!.ip);
    for (let t = 0; t < 10 * 60_000 && restarted.runner.activeCount > 0; t += 1000)
      await w.h.clock.advanceAsync(1000);
    const { devices } = await job(w, jobId);
    expect(devices.find((d) => d.deviceId === w.A[0]!.id)?.result).toBe('acordou');
  });

  it('closes the job as "interrompido" if the window already ended', async () => {
    const w = await world();
    const { jobId } = (await wake(w, roomTarget([w.roomA]))).json<{ jobId: number }>();
    await w.h.clock.advanceAsync(5000);
    w.h.clock.jump(10 * 60_000);
    const restarted = createServices(w.h.services.db, w.h.clock, w.h.ports);
    restarted.runner.recover();
    const { job: j, devices } = await job(w, jobId);
    expect(j.state).toBe('interrompido');
    expect(devices.every((d) => d.result === 'nao_respondeu')).toBe(true);
  });
});

describe('M3 review fixes', () => {
  it('R-M3-01 wake.finish is attributed to the user who started the job', async () => {
    const h = await apiHarness();
    hs.push(h);
    const cookie = await h.as('operator');
    const room = h.services.rooms.create({ name: 'Lab R' }, ACTOR).id;
    h.services.devices.create({ name: 'PC', mac: '00:AA:00:00:0F:01', roomId: room }, ACTOR);
    await h.inject({ method: 'POST', url: '/api/wake', cookie, payload: roomTarget([room]) });
    await drive(h);
    const start = h.services.audit.query({ action: 'wake.start' }).items[0]!;
    const finish = h.services.audit.query({ action: 'wake.finish' }).items[0]!;
    expect(finish.actorUserId).toBe(start.actorUserId);
    expect(finish.actorUserId).not.toBeNull();
  });
});
