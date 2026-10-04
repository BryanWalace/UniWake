/**
 * Query budgets (plan §5.1, NFR-01). Wall-clock guards run in their own sequential, uninstrumented
 * pass (`npm run test:perf`): inside the parallel coverage run, scheduler noise alone exceeds them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiHarness, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
const ACTOR = { id: null, label: 'perf' };

beforeAll(async () => {
  h = await apiHarness();
  const rooms = Array.from(
    { length: 10 },
    (_, i) => h.services.rooms.create({ name: `Lab ${i + 1}`, block: `Bloco ${i % 3}` }, ACTOR).id,
  );
  const tag = h.services.tags.create({ name: 'Professor' }, ACTOR).id;
  const db = h.services.db;
  db.transaction(() => {
    for (let i = 0; i < 500; i++) {
      const id = db.run(
        'INSERT INTO devices (name, mac, room_id, ip, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)',
        [
          `Bench-${String(i).padStart(3, '0')}`,
          `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
          i % 25 === 0 ? null : rooms[i % rooms.length]!,
          `10.1.${i >> 8}.${i & 255}`,
        ],
      ).lastInsertRowid;
      db.run('INSERT INTO device_state (device_id, status) VALUES (?, ?)', [
        id,
        i % 3 ? 'online' : 'offline',
      ]);
      db.run('INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)', [id, tag]);
    }
  });
});

afterAll(async () => {
  await h.close();
});

/** Best of 5 (the first run also warms the statement cache). */
function time(fn: () => unknown): number {
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    fn();
    runs.push(performance.now() - t);
  }
  return Math.min(...runs);
}

describe('query budgets with 500 devices (NFR-01)', () => {
  it('device list: compact and paged under 50 ms', () => {
    expect(time(() => h.services.devices.list({ all: true, page: 1, pageSize: 50 }))).toBeLessThan(
      50,
    );
    expect(time(() => h.services.devices.list({ q: '10.1', page: 3, pageSize: 200 }))).toBeLessThan(
      50,
    );
  });

  it('dashboard and SSE counters under 50 ms', () => {
    expect(time(() => h.services.dashboard.dashboard())).toBeLessThan(50);
    expect(time(() => h.services.dashboard.counters())).toBeLessThan(20);
  });
});

describe('uptime budget (NFR-01)', () => {
  it('a 500-device room over 180 rolled-up days in under 150 ms', () => {
    const db = h.services.db;
    const room = h.services.rooms.create({ name: 'Sala Grande' }, ACTOR).id;
    db.run('UPDATE devices SET room_id = ?', [room]);
    db.transaction(() => {
      const ids = db.all<{ id: number }>('SELECT id FROM devices').map((r) => r.id);
      for (let d = 1; d <= 180; d++) {
        const day = new Date(Date.UTC(2026, 9, 5) - d * 86_400_000).toISOString().slice(0, 10);
        for (const id of ids) {
          db.run('INSERT INTO daily_uptime (device_id, day, online_ms) VALUES (?, ?, ?)', [
            id,
            day,
            3_600_000,
          ]);
        }
      }
    });
    expect(time(() => h.services.dashboard.uptime({ roomId: room, days: 180 }))).toBeLessThan(150);
  });
});
