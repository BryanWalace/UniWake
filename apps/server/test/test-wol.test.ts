import { afterEach, describe, expect, it } from 'vitest';
import type { AuditRow, Page, TestWolRun } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const IP = '10.0.3.40';
const MAC = '00:AB:00:00:00:40';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) {
    h.services.testWol.stop();
    for (let i = 0; i < 400 && h.services.runner.activeCount > 0; i++)
      await h.clock.advanceAsync(5_000);
    await h.close();
  }
});

async function setup(device: { ip?: string | null; hostname?: string | null } = {}) {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const pc = h.services.devices.create(
    { name: 'LAB3-PC40', mac: MAC, ip: IP, ...device },
    ACTOR,
  ).device;
  const run = async (method: 'GET' | 'POST', url: string) => {
    const r = await h.inject({
      method,
      url,
      cookie,
      ...(method === 'POST' ? { payload: {} } : {}),
    });
    return { status: r.statusCode, body: r.json<TestWolRun & { code?: string }>() };
  };
  const start = () => run('POST', `/api/devices/${pc.id}/test-wol`);
  const get = async (id: number) => (await run('GET', `/api/test-wol/${id}`)).body;
  /** Advances in 5 s steps, as the flow polls, until `until` holds or `maxMs` passed. */
  const advanceUntil = async (id: number, until: (r: TestWolRun) => boolean, maxMs: number) => {
    for (let t = 0; t <= maxMs; t += 5_000) {
      const r = await get(id);
      if (until(r)) return r;
      await h.clock.advanceAsync(5_000);
    }
    return get(id);
  };
  return { h, cookie, pc, start, get, run, advanceUntil };
}

describe('Testar WoL desta máquina (FR-007.4)', () => {
  it('AC-007-10: waits for "off", 30 s more, sends, and stores "sucesso" with timestamps', async () => {
    const { h, start, get, advanceUntil } = await setup();
    h.ports.prober.setAlive(IP);
    const r = await start();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      state: 'aguardando_desligar',
      startedAt: T0,
      deviceName: 'LAB3-PC40',
    });
    const id = r.body.id;
    // Still on: nothing happens.
    await h.clock.advanceAsync(20_000);
    expect((await get(id)).state).toBe('aguardando_desligar');
    // Turned off: two missed probes in a row mean "off".
    h.ports.prober.setOffline(IP);
    const off = await advanceUntil(id, (x) => x.state === 'aguardando_placa', 15_000);
    expect(off.offlineAt).not.toBeNull();
    // NIC arming: no packet during the 30 s after "off".
    await h.clock.advanceAsync(25_000);
    expect((await get(id)).sentAt).toBeNull();
    expect(h.ports.sender.macsSent().size).toBe(0);
    const sent = await advanceUntil(id, (x) => x.state === 'aguardando_ligar', 10_000);
    expect(sent.sentAt! - sent.offlineAt!).toBeGreaterThanOrEqual(30_000);
    expect(h.ports.sender.macsSent()).toEqual(new Set([MAC]));
    expect(h.services.wake.job(sent.jobId!).job.source).toBe('test');
    // The computer comes back: the job's verification decides.
    h.ports.prober.setAlive(IP);
    const done = await advanceUntil(id, (x) => x.finishedAt !== null, 6 * 60_000);
    expect(done).toMatchObject({ state: 'sucesso', detail: null });
    expect(done.finishedAt).toBeGreaterThan(done.sentAt!);
    expect(h.services.testWol.latestForDevice(done.deviceId)?.id).toBe(id);
  });

  it('AC-007-10: stores "não acordou" when the computer does not come back in the window', async () => {
    const { h, start, advanceUntil } = await setup();
    h.ports.prober.setOffline(IP);
    const { body } = await start();
    const sent = await advanceUntil(body.id, (x) => x.state === 'aguardando_ligar', 60_000);
    expect(sent.sentAt! - sent.offlineAt!).toBeGreaterThanOrEqual(30_000);
    const done = await advanceUntil(body.id, (x) => x.finishedAt !== null, 7 * 60_000);
    expect(done.state).toBe('nao_acordou');
    expect(done.detail).toMatch(/não respondeu/);
    const cookie = await h.login('operator-user');
    const audit = (await h.inject({ url: '/api/audit?action=test_wol.', cookie })).json<
      Page<AuditRow>
    >();
    expect(audit.items.map((a) => `${a.action} ${a.result}`).sort()).toEqual([
      'test_wol.finish error',
      'test_wol.start ok',
    ]);
  });

  it('sends even when the last sweep still says "online"', async () => {
    const { h, pc, start, advanceUntil } = await setup();
    h.services.db.run("UPDATE device_state SET status = 'online' WHERE device_id = ?", [pc.id]);
    h.ports.prober.setOffline(IP);
    const { body } = await start();
    const sent = await advanceUntil(body.id, (x) => x.state === 'aguardando_ligar', 60_000);
    expect(h.services.wake.job(sent.jobId!).devices[0]!.result).not.toBe('ja_estava_ligado');
    expect(h.ports.sender.macsSent()).toEqual(new Set([MAC]));
  });

  it('can be cancelled while waiting; nothing is sent', async () => {
    const { h, start, run, get } = await setup();
    h.ports.prober.setAlive(IP);
    const { body } = await start();
    const c = await run('POST', `/api/test-wol/${body.id}/cancel`);
    expect(c.body).toMatchObject({ state: 'cancelado', finishedAt: T0 });
    h.ports.prober.setOffline(IP);
    await h.clock.advanceAsync(120_000);
    expect((await get(body.id)).state).toBe('cancelado');
    expect(h.ports.sender.macsSent().size).toBe(0);
  });

  it('gives up when the computer is not turned off within 10 minutes', async () => {
    const { h, start, advanceUntil } = await setup();
    h.ports.prober.setAlive(IP);
    const { body } = await start();
    const done = await advanceUntil(body.id, (x) => x.finishedAt !== null, 11 * 60_000);
    expect(done.state).toBe('falhou');
    expect(done.detail).toMatch(/não desligou em 10 minutos/);
  });

  it('returns the running test instead of starting a second one', async () => {
    const { h, start } = await setup();
    h.ports.prober.setAlive(IP);
    const a = await start();
    const b = await start();
    expect(b.body.id).toBe(a.body.id);
  });

  it('needs an address to watch and an enabled computer', async () => {
    const noAddress = await setup({ ip: null, hostname: null });
    expect((await noAddress.start()).status).toBe(422);
    const { h, pc, start } = await setup();
    h.services.devices.update(pc.id, { enabled: false }, ACTOR);
    expect((await start()).body.code).toBe('VALIDATION_FAILED');
    expect((await (await setup()).run('GET', '/api/test-wol/999')).status).toBe(404);
  });

  it('a restart ends unfinished tests as "cancelado"', async () => {
    const { h, start, get } = await setup();
    h.ports.prober.setAlive(IP);
    const { body } = await start();
    h.services.testWol.stop();
    h.services.testWol.recover();
    expect(await get(body.id)).toMatchObject({
      state: 'cancelado',
      detail: 'Interrompido: o UniWake foi reiniciado.',
    });
  });
});
