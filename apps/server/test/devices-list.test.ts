import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Device, DeviceCompact, Page } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';

let h: ApiHarness;
let cookie: string;
const ids: Record<string, number> = {};

async function get<T>(url: string): Promise<T> {
  const r = await h.inject({ url, cookie });
  expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
  return r.json<T>();
}

beforeAll(async () => {
  h = await apiHarness();
  cookie = await h.as('operator');
  const post = async (url: string, payload: object) =>
    (await h.inject({ method: 'POST', url, cookie, payload })).json<{ id: number }>();
  ids.lab1 = (await post('/api/rooms', { name: 'Lab 1' })).id;
  ids.lab2 = (await post('/api/rooms', { name: 'Lab 2' })).id;
  ids.prof = (await post('/api/tags', { name: 'professor' })).id;
  const mk = async (name: string, mac: string, extra: object = {}) =>
    (
      await h.inject({
        method: 'POST',
        url: '/api/devices',
        cookie,
        payload: { name, mac, ...extra },
      })
    ).json<{
      device: { id: number };
    }>().device.id;
  ids.a = await mk('Lab1-PC01', '00:1A:2B:00:00:01', {
    roomId: ids.lab1,
    ip: '10.0.3.21',
    tagIds: [ids.prof],
  });
  ids.b = await mk('Lab1-PC02', '00:1A:2B:00:00:02', {
    roomId: ids.lab1,
    ip: '10.0.3.22',
    hostname: 'LAB1-PC02',
  });
  ids.c = await mk('Lab2-PC01', '00:1A:2B:00:00:03', { roomId: ids.lab2, ip: '10.0.4.21' });
  ids.d = await mk('Solto_100%', '00:1A:2B:00:00:04');
  h.services.db.run("UPDATE device_state SET status = 'online' WHERE device_id IN (?, ?)", [
    ids.a,
    ids.c,
  ]);
  h.services.db.run("UPDATE device_state SET status = 'offline' WHERE device_id = ?", [ids.b]);
});
afterAll(async () => {
  await h.close();
});

const names = (p: Page<Device> | DeviceCompact[]) =>
  ('items' in p ? p.items : p).map((d) => d.name);

describe('device list filters (FR-002, FR-004.5)', () => {
  it('filters by room, "Sem sala", tag and status', async () => {
    expect(names(await get(`/api/devices?roomId=${ids.lab1}`))).toEqual(['Lab1-PC01', 'Lab1-PC02']);
    expect(names(await get('/api/devices?roomId=none'))).toEqual(['Solto_100%']);
    expect(names(await get(`/api/devices?tagId=${ids.prof}`))).toEqual(['Lab1-PC01']);
    expect(names(await get('/api/devices?status=online'))).toEqual(['Lab1-PC01', 'Lab2-PC01']);
    expect(names(await get('/api/devices?status=desconhecido'))).toEqual(['Solto_100%']);
  });

  it('AC-004-15 searches name, IP, hostname and MAC in any format', async () => {
    expect(names(await get('/api/devices?q=10.0.3.2'))).toEqual(['Lab1-PC01', 'Lab1-PC02']);
    expect(names(await get('/api/devices?q=lab1-pc02'))).toEqual(['Lab1-PC02']);
    expect(names(await get('/api/devices?q=00-1a-2b-00-00-03'))).toEqual(['Lab2-PC01']);
    expect(names(await get('/api/devices?q=1A2B000004'))).toEqual(['Solto_100%']);
    expect(names(await get(`/api/devices?q=${encodeURIComponent('100%')}`))).toEqual([
      'Solto_100%',
    ]);
    expect(names(await get('/api/devices?q=_'))).toEqual(['Solto_100%']); // "_" is literal, not a wildcard
  });

  it('paginates with totals and caps page size at 200', async () => {
    const p1 = await get<Page<Device>>('/api/devices?page=1&pageSize=3');
    expect(p1).toMatchObject({ total: 4, page: 1, pageSize: 3 });
    expect(p1.items).toHaveLength(3);
    const p2 = await get<Page<Device>>('/api/devices?page=2&pageSize=3');
    expect(p2.items.map((d) => d.name)).toEqual(['Solto_100%']);
    expect((await h.inject({ url: '/api/devices?pageSize=500', cookie })).statusCode).toBe(422);
  });

  it('returns the compact list for the dashboard with all=1', async () => {
    const list = await get<DeviceCompact[]>(`/api/devices?all=1&roomId=${ids.lab1}`);
    expect(list).toHaveLength(2);
    expect(Object.keys(list[0]!).sort()).toEqual(
      [
        'enabled',
        'hostname',
        'id',
        'ip',
        'lastSeenAt',
        'latencyMs',
        'mac',
        'name',
        'roomId',
        'status',
        'tagIds',
      ].sort(),
    );
  });
});

describe('device list performance (plan §5.1, NFR-01)', () => {
  it('lists 500 devices with tags in under 50 ms (compact and paged)', async () => {
    const db = h.services.db;
    db.transaction(() => {
      for (let i = 0; i < 500; i++) {
        const id = db.run(
          'INSERT INTO devices (name, mac, room_id, ip, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)',
          [
            `Bench-${String(i).padStart(3, '0')}`,
            `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
            i % 2 ? ids.lab1! : ids.lab2!,
            `10.1.${i >> 8}.${i & 255}`,
          ],
        ).lastInsertRowid;
        db.run('INSERT INTO device_state (device_id, status) VALUES (?, ?)', [
          id,
          i % 3 ? 'online' : 'offline',
        ]);
        db.run('INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)', [id, ids.prof!]);
      }
    });
    const time = (fn: () => unknown) => {
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        fn();
        runs.push(performance.now() - t);
      }
      // Best of 5: other test files run in parallel, and scheduler noise only ever adds time.
      return Math.min(...runs);
    };
    const compact = time(() => h.services.devices.list({ all: true, page: 1, pageSize: 50 }));
    const paged = time(() => h.services.devices.list({ q: '10.1', page: 3, pageSize: 200 }));
    expect(compact).toBeLessThan(50);
    expect(paged).toBeLessThan(50);
  });
});
