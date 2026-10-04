import { afterEach, describe, expect, it } from 'vitest';
import type { Device, DeviceSaveResult } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const post = async <T>(url: string, payload: object) => {
    const r = await h.inject({ method: 'POST', url, cookie, payload });
    return { status: r.statusCode, body: r.json<T>() };
  };
  const rooms = [];
  for (const name of ['Lab 1', 'Lab 2', 'Lab 3', 'Lab 4']) {
    rooms.push((await post<{ id: number }>('/api/rooms', { name })).body.id);
  }
  const devices: number[] = [];
  for (let i = 0; i < 12; i++) {
    const mac = `00:AA:00:00:00:${i.toString(16).padStart(2, '0')}`;
    const r = await post<DeviceSaveResult>('/api/devices', {
      name: `PC-${i}`,
      mac,
      roomId: rooms[i % 3],
    });
    devices.push(r.body.device.id);
  }
  return { h, cookie, post, rooms, devices };
}

describe('bulk device operations (FR-002.2)', () => {
  it('AC-002-07 moving 12 devices from 3 rooms to Lab 3 updates all and writes one audit entry', async () => {
    const { h, post, rooms, devices } = await setup();
    const lab4 = rooms[3]!;
    const r = await post('/api/devices/bulk', { action: 'move', deviceIds: devices, roomId: lab4 });
    expect(r).toEqual({ status: 200, body: { affected: 12 } });
    const inLab4 = h.services.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM devices WHERE room_id = ?',
      [lab4],
    );
    expect(inLab4?.n).toBe(12);
    const audit = h.services.audit.query({ action: 'device.bulk.move' });
    expect(audit.total).toBe(1);
    expect(audit.items[0]?.details).toMatchObject({ deviceIds: devices, roomId: lab4 });
    expect((audit.items[0]?.details.fromRooms as unknown[]).length).toBe(3);
  });

  it('adds and removes tags in bulk without duplicates', async () => {
    const { h, cookie, post, devices } = await setup();
    const tag = (await post<{ id: number }>('/api/tags', { name: 'manhã' })).body.id;
    const some = devices.slice(0, 5);
    await post('/api/devices/bulk', { action: 'addTags', deviceIds: some, tagIds: [tag] });
    await post('/api/devices/bulk', { action: 'addTags', deviceIds: some, tagIds: [tag] });
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM device_tags')?.n).toBe(5);
    await post('/api/devices/bulk', {
      action: 'removeTags',
      deviceIds: some.slice(0, 2),
      tagIds: [tag],
    });
    const d = (await h.inject({ url: `/api/devices/${some[0]}`, cookie })).json<Device>();
    expect(d.tagIds).toEqual([]);
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM device_tags')?.n).toBe(3);
  });

  it('enables, disables and deletes (delete requires confirm: true)', async () => {
    const { h, post, devices } = await setup();
    await post('/api/devices/bulk', { action: 'disable', deviceIds: devices.slice(0, 4) });
    expect(
      h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices WHERE enabled = 0')?.n,
    ).toBe(4);
    await post('/api/devices/bulk', { action: 'enable', deviceIds: devices.slice(0, 2) });
    expect(
      h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices WHERE enabled = 0')?.n,
    ).toBe(2);

    const unconfirmed = await post('/api/devices/bulk', {
      action: 'delete',
      deviceIds: devices.slice(0, 3),
    });
    expect(unconfirmed.status).toBe(422);
    const ok = await post('/api/devices/bulk', {
      action: 'delete',
      deviceIds: devices.slice(0, 3),
      confirm: true,
    });
    expect(ok.body).toEqual({ affected: 3 });
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(9);
  });

  it('is all-or-nothing: an unknown device id or room aborts the whole operation', async () => {
    const { h, post, rooms, devices } = await setup();
    const r = await post('/api/devices/bulk', {
      action: 'move',
      deviceIds: [...devices, 9999],
      roomId: rooms[3],
    });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'DEVICE_NOT_FOUND', details: { missing: [9999] } });
    const badRoom = await post('/api/devices/bulk', {
      action: 'move',
      deviceIds: devices,
      roomId: 9999,
    });
    expect(badRoom.status).toBe(422);
    expect(
      h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices WHERE room_id = ?', [
        rooms[3]!,
      ])?.n,
    ).toBe(0);
    expect(h.services.audit.query({ actionPrefix: 'device.bulk' }).total).toBe(0);
  });

  it('moves to "Sem sala" with roomId null', async () => {
    const { h, post, devices } = await setup();
    await post('/api/devices/bulk', {
      action: 'move',
      deviceIds: devices.slice(0, 2),
      roomId: null,
    });
    expect(
      h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices WHERE room_id IS NULL')
        ?.n,
    ).toBe(2);
  });
});
