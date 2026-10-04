import { afterEach, describe, expect, it } from 'vitest';
import type { Counters, Dashboard, DeviceHistoryPage, UptimeSeries } from '@uniwake/shared';
import { addDays, dayRange, dayStart, localDay, nextLocalTime } from '../src/domain/tz';
import { average, onlineMs } from '../src/domain/uptime';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

const SP = 'America/Sao_Paulo';
const H = 3_600_000;
const ACTOR = { id: null, label: 'teste' };

describe('domain/tz', () => {
  it('maps instants to local days and back in America/Sao_Paulo (UTC−3)', () => {
    expect(localDay(T0, SP)).toBe('2026-10-05'); // 09:00Z = 06:00 local
    expect(localDay(Date.UTC(2026, 9, 5, 2, 59), SP)).toBe('2026-10-04');
    expect(dayStart('2026-10-05', SP)).toBe(Date.UTC(2026, 9, 5, 3, 0));
    expect(dayRange('2026-10-05', SP)).toEqual({
      start: Date.UTC(2026, 9, 5, 3),
      end: Date.UTC(2026, 9, 6, 3),
    });
  });

  it('handles 23 h and 25 h days and a skipped midnight', () => {
    const ny = dayRange('2026-03-08', 'America/New_York');
    expect(ny.end - ny.start).toBe(23 * H);
    const nyBack = dayRange('2026-11-01', 'America/New_York');
    expect(nyBack.end - nyBack.start).toBe(25 * H);
    // Brazil 2018: clocks jumped 00:00 → 01:00 on 2018-11-04; the day starts at 01:00 (03:00Z).
    expect(dayStart('2018-11-04', SP)).toBe(Date.UTC(2018, 10, 4, 3, 0));
    expect(localDay(dayStart('2018-11-04', SP) - 1, SP)).toBe('2018-11-03');
  });

  it('adds days across month and year ends and finds the next local HH:mm', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(nextLocalTime(T0, '00:10', SP)).toBe(Date.UTC(2026, 9, 6, 3, 10));
    expect(nextLocalTime(T0, '06:30', SP)).toBe(Date.UTC(2026, 9, 5, 9, 30));
  });
});

describe('domain/uptime', () => {
  it('AC-004-10: online 08:00 → offline 12:00 is 4 h, 16.7% of the day', () => {
    const { start, end } = dayRange('2026-10-05', SP);
    const ms = onlineMs(
      'offline',
      [
        { at: start + 8 * H, to: 'online' },
        { at: start + 12 * H, to: 'offline' },
      ],
      start,
      end,
    );
    expect(ms).toBe(4 * H);
    expect(Math.round((ms / (end - start)) * 1000) / 10).toBe(16.7);
  });

  it('carries the status across the day start and ignores changes outside the window', () => {
    expect(onlineMs('online', [{ at: 5, to: 'offline' }], 0, 10)).toBe(5);
    expect(
      onlineMs(
        'online',
        [
          { at: -5, to: 'offline' },
          { at: 20, to: 'offline' },
        ],
        0,
        10,
      ),
    ).toBe(10);
    expect(onlineMs('online', [], 10, 10)).toBe(0);
  });

  it('AC-004-16: room uptime is the average of its devices; unknown days are skipped', () => {
    expect(average([0.5, 1])).toBe(0.75);
    expect(average([0.5, null])).toBe(0.5);
    expect(average([])).toBeNull();
  });
});

describe('dashboard and uptime API', () => {
  const hs: ApiHarness[] = [];
  afterEach(async () => {
    for (const h of hs.splice(0)) {
      h.services.dashboard.stop();
      await h.close();
    }
  });

  async function setup() {
    const h = await apiHarness();
    hs.push(h);
    const cookie = await h.as('operator');
    const get = async <T>(url: string) => {
      const r = await h.inject({ url, cookie });
      return { status: r.statusCode, body: r.json<T>() };
    };
    return { h, cookie, get };
  }

  const statusEvent = (h: ApiHarness, deviceId: number, at: number, to: string) =>
    h.services.db.run(
      "INSERT INTO device_events (device_id, at, type, data) VALUES (?, ?, 'status', ?)",
      [deviceId, at, JSON.stringify({ to })],
    );
  const mac = (i: number) => `00:DD:00:00:00:${i.toString(16).padStart(2, '0')}`;

  it('AC-004-09: room cards ordered block → floor → name, "Sem sala" last, correct counters', async () => {
    const { h, get } = await setup();
    const r = h.services.rooms;
    const lab10 = r.create({ name: 'Lab 10', block: 'B', floor: '1' }, ACTOR).id;
    const lab2 = r.create({ name: 'Lab 2', block: 'B', floor: '1' }, ACTOR).id;
    const aud = r.create({ name: 'Auditório', block: 'A' }, ACTOR).id;
    const loose = r.create({ name: 'Biblioteca' }, ACTOR).id;
    const dev = (i: number, roomId: number | null) =>
      h.services.devices.create({ name: `PC-${i}`, mac: mac(i), roomId, ip: `10.0.3.${i}` }, ACTOR)
        .device.id;
    const a1 = dev(1, lab2);
    dev(2, lab2);
    dev(3, lab10);
    const off = dev(4, aud);
    dev(5, null);
    const disabled = dev(6, null);
    h.ports.prober.setAlive('10.0.3.1');
    h.ports.prober.setAlive('10.0.3.6');
    await h.services.monitor.sweep();
    h.services.devices.update(disabled, { enabled: false }, ACTOR);

    const { status, body } = await get<Dashboard>('/api/dashboard');
    expect(status).toBe(200);
    expect(body.rooms.map((x) => x.id)).toEqual([aud, lab2, lab10, loose]);
    expect(body.rooms.find((x) => x.id === lab2)!.counts).toEqual({
      online: 1,
      offline: 1,
      desconhecido: 0,
      total: 2,
    });
    expect(body.rooms.find((x) => x.id === loose)!.counts.total).toBe(0);
    expect(body.noRoom).toEqual({ online: 0, offline: 1, desconhecido: 1, total: 2 });
    expect(body.counters).toEqual({ online: 1, offline: 4, desconhecido: 1, total: 6 });
    expect(body.demo).toBe(false);
    expect(body.lastSweepAt).toBe(T0);
    expect(a1).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
  });

  it('shows the latest wake job per room counted over that room only, tags and open notices', async () => {
    const { h, get } = await setup();
    const room = h.services.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    const other = h.services.rooms.create({ name: 'Lab 2' }, ACTOR).id;
    const tag = h.services.tags.create({ name: 'Projetor', color: '#336699' }, ACTOR).id;
    for (let i = 1; i <= 3; i++) {
      h.services.devices.create(
        {
          name: `PC-${i}`,
          mac: mac(i),
          roomId: i < 3 ? room : other,
          ip: `10.0.3.${i}`,
          tagIds: [tag],
        },
        ACTOR,
      );
    }
    h.ports.prober.setAlive('10.0.3.1');
    await h.services.monitor.sweep();
    const job = h.services.wake.start({ target: { type: 'all' }, onlyOffline: false }, ACTOR, {
      source: 'manual',
      preConfirmed: true,
    });
    for (let t = 0; t < 600 && h.services.runner.activeCount > 0; t++)
      await h.clock.advanceAsync(1000);
    h.services.db.run("INSERT INTO notices (type, created_at, data) VALUES ('demo', ?, '{}')", [
      T0,
    ]);
    h.services.db.run(
      "INSERT INTO notices (type, created_at, data, acknowledged_at) VALUES ('old', ?, '{}', ?)",
      [T0, T0],
    );

    const { body } = await get<Dashboard>('/api/dashboard');
    const card = body.rooms.find((x) => x.id === room)!;
    expect(card.lastAction).toMatchObject({
      jobId: job.jobId,
      source: 'manual',
      total: 2,
      alreadyOn: 1,
    });
    expect(body.rooms.find((x) => x.id === other)!.lastAction).toMatchObject({ total: 1 });
    expect(body.tags).toEqual([{ id: tag, name: 'Projetor', color: '#336699', total: 3 }]);
    expect(body.notices.map((n) => n.type)).toEqual(['demo']);
  });

  it('AC-004-10: device uptime per local day, today computed so far', async () => {
    const { h, get } = await setup();
    const today = localDay(T0, SP);
    const yesterday = addDays(today, -1);
    h.clock.set(dayStart(addDays(today, -3), SP)); // device created three days ago
    const id = h.services.devices.create({ name: 'PC', mac: mac(1), ip: '10.0.3.1' }, ACTOR).device
      .id;
    const y = dayStart(yesterday, SP);
    statusEvent(h, id, y + 8 * H, 'online');
    statusEvent(h, id, y + 12 * H, 'offline');
    const t = dayStart(today, SP);
    statusEvent(h, id, t + 2 * H, 'online');
    h.clock.set(t + 6 * H); // 06:00 local: online for 4 h of the 6 elapsed

    const { status, body } = await get<UptimeSeries>(`/api/uptime?deviceId=${id}&days=5`);
    expect(status).toBe(200);
    expect(body.days.map((d) => d.day)).toEqual([
      addDays(today, -4),
      addDays(today, -3),
      addDays(today, -2),
      yesterday,
      today,
    ]);
    expect(body.days[0]!.ratio).toBeNull(); // before the device existed
    expect(body.days[1]!.ratio).toBe(0);
    expect(body.days[3]!.ratio).toBeCloseTo(4 / 24, 6);
    expect(body.days[4]!.ratio).toBeCloseTo(4 / 6, 6);
  });

  it('AC-004-16: room uptime averages its devices (50% and 100% → 75%)', async () => {
    const { h, get } = await setup();
    const today = localDay(T0, SP);
    const yesterday = addDays(today, -1);
    const y = dayStart(yesterday, SP);
    h.clock.set(y - H);
    const room = h.services.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    const a = h.services.devices.create({ name: 'A', mac: mac(1), roomId: room }, ACTOR).device.id;
    const b = h.services.devices.create({ name: 'B', mac: mac(2), roomId: room }, ACTOR).device.id;
    statusEvent(h, a, y, 'online');
    statusEvent(h, a, y + 12 * H, 'offline');
    statusEvent(h, b, y - 1, 'online');
    h.clock.set(T0);

    const { body } = await get<UptimeSeries>(`/api/uptime?roomId=${room}&days=2`);
    expect(body.days[0]).toEqual({ day: yesterday, ratio: 0.75 });
  });

  it('nightly rollup writes daily_uptime at 00:10 local, catches up, and stored days are used', async () => {
    const { h, get } = await setup();
    const today = localDay(T0, SP);
    h.clock.set(dayStart(addDays(today, -3), SP) + H);
    const id = h.services.devices.create({ name: 'PC', mac: mac(1) }, ACTOR).device.id;
    statusEvent(h, id, h.clock.now(), 'online');
    h.clock.set(T0);

    h.services.dashboard.start(); // catch-up: the three finished days
    const rows = () =>
      h.services.db.all<{ day: string; online_ms: number }>(
        'SELECT day, online_ms FROM daily_uptime ORDER BY day',
      );
    expect(rows()).toEqual([
      { day: addDays(today, -3), online_ms: 23 * H },
      { day: addDays(today, -2), online_ms: 24 * H },
      { day: addDays(today, -1), online_ms: 24 * H },
    ]);

    // Stored rows win over the event timeline (e.g. after event retention trimmed history).
    h.services.db.run('UPDATE daily_uptime SET online_ms = ? WHERE day = ?', [
      6 * H,
      addDays(today, -1),
    ]);
    const { body } = await get<UptimeSeries>(`/api/uptime?deviceId=${id}&days=2`);
    expect(body.days[0]!.ratio).toBe(0.25);

    // 00:10 local tomorrow rolls up today.
    await h.clock.advanceAsync(nextLocalTime(T0, '00:10', SP) - T0);
    expect(rows().map((r) => r.day)).toContain(today);
  });

  it('a hub restart dates the reset at the last probe, so downtime is not counted as uptime', async () => {
    const { h } = await setup();
    const id = h.services.devices.create({ name: 'PC', mac: mac(1), ip: '10.0.3.1' }, ACTOR).device
      .id;
    h.ports.prober.setAlive('10.0.3.1');
    await h.services.monitor.sweep(); // online at T0
    h.clock.set(T0 + 10 * H); // hub was down for 10 h
    h.services.monitor.start();
    await h.services.monitor.stop();
    const { start } = dayRange(localDay(T0, SP), SP);
    const ms = h.services.dashboard.uptime({ deviceId: id, days: 1 });
    expect(ms.days[0]!.ratio).toBe(0); // online at T0 then desconhecido at T0: nothing counted
    expect(start).toBeLessThan(T0);
  });

  it('validates the uptime query (422) and the target (404)', async () => {
    const { h, get } = await setup();
    expect((await get('/api/uptime')).status).toBe(422);
    expect((await get('/api/uptime?deviceId=1&roomId=1')).status).toBe(422);
    expect((await get('/api/uptime?deviceId=1&days=400')).status).toBe(422);
    expect((await get<{ code: string }>('/api/uptime?deviceId=99')).body.code).toBe(
      'DEVICE_NOT_FOUND',
    );
    expect((await get<{ code: string }>('/api/uptime?roomId=99')).body.code).toBe('NOT_FOUND');
    const anon = await h.inject({ url: '/api/dashboard' });
    expect(anon.statusCode).toBe(401);
  });

  it('counters() feeds the SSE counters event', async () => {
    const { h } = await setup();
    const room = h.services.rooms.create({ name: 'Lab 1' }, ACTOR).id;
    h.services.devices.create({ name: 'PC', mac: mac(1), roomId: room, ip: '10.0.3.1' }, ACTOR);
    h.ports.prober.setAlive('10.0.3.1');
    await h.services.monitor.sweep();
    const c: Counters = h.services.dashboard.counters();
    expect(c).toEqual({
      global: { online: 1, offline: 0, desconhecido: 0, total: 1 },
      rooms: [{ roomId: room, online: 1, offline: 0, desconhecido: 0, total: 1 }],
    });
  });
  it('FR-004.6: device history lists status, IP drift and wake attempts newest first, paged without splitting an instant', async () => {
    const { h, get } = await setup();
    const id = h.services.devices.create(
      { name: 'PC', mac: mac(1), ip: '10.0.3.1', hostname: 'pc' },
      ACTOR,
    ).device.id;
    h.ports.dns.records.set('pc', ['10.0.3.9']);
    h.ports.prober.setAlive('10.0.3.9');
    await h.services.monitor.sweep(); // ip_changed + status online, same instant
    h.clock.advance(60_000);
    h.ports.prober.setOffline('10.0.3.9');
    await h.services.monitor.sweep();
    await h.services.monitor.sweep(); // offline
    h.clock.advance(60_000);
    const { jobId } = h.services.wake.start(
      { target: { type: 'devices', deviceIds: [id] }, onlyOffline: false },
      ACTOR,
      { preConfirmed: true },
    );
    for (let t = 0; t < 300 && h.services.runner.activeCount > 0; t++)
      await h.clock.advanceAsync(1000);

    const all = await get<DeviceHistoryPage>(`/api/devices/${id}/history`);
    expect(all.status).toBe(200);
    expect(all.body.items.map((i) => i.kind)).toEqual(['wake', 'status', 'status', 'ip_changed']);
    expect(all.body.items[0]).toMatchObject({ kind: 'wake', jobId, source: 'manual' });
    expect(all.body.items[1]).toMatchObject({ kind: 'status', from: 'online', to: 'offline' });
    expect(all.body.items[3]).toMatchObject({
      kind: 'ip_changed',
      from: '10.0.3.1',
      to: '10.0.3.9',
    });
    expect(all.body.nextBefore).toBeNull();

    // limit 3 ends on the instant shared by "online" and "ip_changed": both come in this page.
    const p1 = await get<DeviceHistoryPage>(`/api/devices/${id}/history?limit=3`);
    expect(p1.body.items).toHaveLength(4);
    const p2 = await get<DeviceHistoryPage>(
      `/api/devices/${id}/history?limit=3&before=${p1.body.nextBefore}`,
    );
    expect(p2.body.items).toEqual([]);

    expect((await get<{ code: string }>('/api/devices/999/history')).body.code).toBe(
      'DEVICE_NOT_FOUND',
    );
  });
});
