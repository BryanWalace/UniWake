import { afterEach, describe, expect, it } from 'vitest';
import type { Device, DeviceSaveResult } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});
async function harness() {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const post = (url: string, payload: object) => h.inject({ method: 'POST', url, cookie, payload });
  return { h, cookie, post };
}

describe('devices API (FR-002.1)', () => {
  it('AC-002-01 normalizes aa-bb-cc-dd-ee-ff to AA:BB:CC:DD:EE:FF on create and update', async () => {
    const { h, cookie, post } = await harness();
    const r = await post('/api/devices', { name: 'PC-01', mac: 'a8-bb-cc-dd-ee-ff' });
    expect(r.statusCode).toBe(201);
    const { device } = r.json<DeviceSaveResult>();
    expect(device.mac).toBe('A8:BB:CC:DD:EE:FF');
    const upd = await h.inject({
      method: 'PATCH',
      url: `/api/devices/${device.id}`,
      cookie,
      payload: { mac: 'a8bb.ccdd.ee00' },
    });
    expect(upd.json<DeviceSaveResult>().device.mac).toBe('A8:BB:CC:DD:EE:00');
  });

  it('AC-002-02 a MAC already registered (any format) gives 409 naming the existing device', async () => {
    const { post } = await harness();
    await post('/api/devices', { name: 'PC-Lab3-01', mac: '00:1A:2B:3C:4D:5E' });
    const dup = await post('/api/devices', { name: 'Outro', mac: '001a2b3c4d5e' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({
      code: 'DEVICE_MAC_DUPLICATE',
      message: 'O MAC 00:1A:2B:3C:4D:5E já está cadastrado no dispositivo "PC-Lab3-01".',
    });
  });

  it('AC-002-02 changing a MAC to one used by another device is refused', async () => {
    const { h, cookie, post } = await harness();
    await post('/api/devices', { name: 'A', mac: '00:00:00:00:00:0A' });
    const b = (
      await post('/api/devices', { name: 'B', mac: '00:00:00:00:00:0B' })
    ).json<DeviceSaveResult>();
    const r = await h.inject({
      method: 'PATCH',
      url: `/api/devices/${b.device.id}`,
      cookie,
      payload: { mac: '00-00-00-00-00-0a' },
    });
    expect(r.statusCode).toBe(409);
  });

  it('AC-002-03 multicast, broadcast and all-zero MACs give 422', async () => {
    const { post } = await harness();
    for (const mac of ['01:00:5E:00:00:01', 'FF:FF:FF:FF:FF:FF', '00:00:00:00:00:00', 'nonsense']) {
      const r = await post('/api/devices', { name: 'X', mac });
      expect(r.statusCode, mac).toBe(422);
      expect(r.json()).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'mac' }] });
    }
  });

  it('AC-002-04 a locally administered MAC is saved with a warning flag', async () => {
    const { post } = await harness();
    const r = await post('/api/devices', { name: 'Talvez Wi-Fi', mac: '02:00:00:00:00:01' });
    expect(r.statusCode).toBe(201);
    const body = r.json<DeviceSaveResult>();
    expect(body.warnings).toContain('mac_locally_administered');
    expect(body.device.flags.macLocallyAdministered).toBe(true);
  });

  it('AC-002-05 a disabled device reads as desconhecido and keeps its data', async () => {
    const { h, cookie, post } = await harness();
    const { device } = (
      await post('/api/devices', { name: 'PC', mac: '00:11:22:33:44:55', ip: '10.0.3.20' })
    ).json<DeviceSaveResult>();
    h.services.db.run(
      "UPDATE device_state SET status = 'online', latency_ms = 3, ever_online = 1 WHERE device_id = ?",
      [device.id],
    );
    expect(
      (await h.inject({ url: `/api/devices/${device.id}`, cookie })).json<Device>().status,
    ).toBe('online');
    await h.inject({
      method: 'PATCH',
      url: `/api/devices/${device.id}`,
      cookie,
      payload: { enabled: false },
    });
    const d = (await h.inject({ url: `/api/devices/${device.id}`, cookie })).json<Device>();
    expect(d).toMatchObject({
      enabled: false,
      status: 'desconhecido',
      latencyMs: null,
      ip: '10.0.3.20',
    });
  });

  it('duplicate names are allowed with a warning (phase-1 F1-01)', async () => {
    const { post } = await harness();
    await post('/api/devices', { name: 'PC-01', mac: '00:00:00:00:00:01' });
    const r = await post('/api/devices', { name: 'pc-01', mac: '00:00:00:00:00:02' });
    expect(r.statusCode).toBe(201);
    expect(r.json<DeviceSaveResult>().warnings).toEqual(['duplicate_name']);
  });

  it('stores room, tags, IP, hostname and notes; unknown room/tag → 422; delete works', async () => {
    const { h, cookie, post } = await harness();
    const room = (await post('/api/rooms', { name: 'Lab 3' })).json<{ id: number }>();
    const t1 = (await post('/api/tags', { name: 'professor' })).json<{ id: number }>();
    const t2 = (await post('/api/tags', { name: 'Win11' })).json<{ id: number }>();
    const r = await post('/api/devices', {
      name: 'PC-Prof',
      mac: '00:11:22:33:44:66',
      ip: '10.0.3.15',
      hostname: 'LAB3-PROF',
      roomId: room.id,
      tagIds: [t2.id, t1.id, t1.id],
      notes: 'Mesa do professor',
    });
    expect(r.json<DeviceSaveResult>().device).toMatchObject({
      roomId: room.id,
      tagIds: [t1.id, t2.id],
      ip: '10.0.3.15',
      hostname: 'LAB3-PROF',
      notes: 'Mesa do professor',
      enabled: true,
      status: 'desconhecido',
      flags: { neverResponded: true },
    });
    const id = r.json<DeviceSaveResult>().device.id;
    const retag = await h.inject({
      method: 'PATCH',
      url: `/api/devices/${id}`,
      cookie,
      payload: { tagIds: [], roomId: null },
    });
    expect(retag.json<DeviceSaveResult>().device).toMatchObject({ tagIds: [], roomId: null });

    const badRoom = await post('/api/devices', {
      name: 'X',
      mac: '00:11:22:33:44:77',
      roomId: 999,
    });
    expect(badRoom.statusCode).toBe(422);
    expect(badRoom.json()).toMatchObject({ details: [{ path: 'roomId' }] });
    const badTag = await post('/api/devices', {
      name: 'X',
      mac: '00:11:22:33:44:77',
      tagIds: [999],
    });
    expect(badTag.json()).toMatchObject({ details: [{ path: 'tagIds' }] });

    expect(
      (await h.inject({ method: 'DELETE', url: `/api/devices/${id}`, cookie })).statusCode,
    ).toBe(204);
    expect((await h.inject({ url: `/api/devices/${id}`, cookie })).statusCode).toBe(404);
    expect(h.services.audit.query({ actionPrefix: 'device.' }).total).toBe(3);
  });

  it('rejects invalid IPs and hostnames', async () => {
    const { post } = await harness();
    const ip = await post('/api/devices', {
      name: 'X',
      mac: '00:11:22:33:44:88',
      ip: '10.0.0.256',
    });
    expect(ip.statusCode).toBe(422);
    const host = await post('/api/devices', {
      name: 'X',
      mac: '00:11:22:33:44:88',
      hostname: 'bad host',
    });
    expect(host.statusCode).toBe(422);
  });
});
