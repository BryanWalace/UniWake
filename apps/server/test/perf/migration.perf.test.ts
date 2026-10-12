/**
 * NFR-401 (M24-T02): export and import preview of 500 devices, 50 schedules and a year of their
 * runs in under 3 s each, with a file under 5 MB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportPreview } from '@uniwake/shared';
import { baselineChangeLog } from '../../src/db/sync/change-log';
import { apiHarness, type ApiHarness } from '../helpers/api';

const ACTOR = { id: null, label: 'perf' };
const DAY = 86_400_000;

let a: ApiHarness;
let b: ApiHarness;

beforeAll(async () => {
  a = await apiHarness();
  b = await apiHarness();
  const s = a.services;
  const rooms = Array.from(
    { length: 10 },
    (_, i) => s.rooms.create({ name: `Lab ${i + 1}` }, ACTOR).id,
  );
  const db = s.db;
  const devices: number[] = [];
  db.transaction(() => {
    for (let i = 0; i < 500; i++) {
      devices.push(
        Number(
          db.run(
            'INSERT INTO devices (name, mac, room_id, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
            [
              `Bench-${String(i).padStart(3, '0')}`,
              `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
              rooms[i % rooms.length]!,
            ],
          ).lastInsertRowid,
        ),
      );
    }
  });
  baselineChangeLog(db);
  const schedules = Array.from(
    { length: 50 },
    (_, i) =>
      s.schedules.create(
        {
          name: `Agendamento ${i}`,
          weekdays: 127,
          timeLocal: `0${7 + (i % 3)}:${String(i % 60).padStart(2, '0')}`,
          target: { type: 'devices', deviceIds: [devices[i]!] },
        },
        ACTOR,
      ).id,
  );
  // A year of daily runs per schedule, written raw like a long-lived hub (then logged).
  db.transaction(() => {
    for (const id of schedules)
      for (let d = 0; d < 365; d++)
        db.run(
          "INSERT INTO schedule_runs (schedule_id, planned_at, claimed_at, status) VALUES (?, ?, ?, 'ok')",
          [id, a.clock.now() - d * DAY, a.clock.now() - d * DAY],
        );
  });
  baselineChangeLog(db);
});

afterAll(async () => {
  await a.close();
  await b.close();
});

describe('export and preview at scale (NFR-401)', () => {
  it('exports in < 3 s into a file < 5 MB, and previews it on another hub in < 3 s', async () => {
    const adminA = await a.as('admin');
    let t = performance.now();
    const exported = await a.inject({
      method: 'POST',
      url: '/api/migration/export',
      cookie: adminA,
      payload: { sections: ['inventory', 'schedules', 'settings', 'history'] },
    });
    const exportMs = performance.now() - t;
    expect(exported.statusCode).toBe(200);
    expect(exportMs).toBeLessThan(3000);
    expect(exported.rawPayload.length).toBeLessThan(5 * 1024 * 1024);

    const adminB = await b.as('admin');
    t = performance.now();
    const inspect = await b.inject({
      method: 'POST',
      url: '/api/migration/import',
      cookie: adminB,
      headers: { 'content-type': 'application/octet-stream' },
      payload: exported.rawPayload,
    });
    const { importId } = inspect.json<{ importId: string }>();
    const preview = await b.inject({
      method: 'POST',
      url: `/api/migration/import/${importId}/preview`,
      cookie: adminB,
      payload: { mode: 'merge' },
    });
    const previewMs = performance.now() - t;
    expect(preview.statusCode).toBe(200);
    const p = preview.json<ImportPreview>();
    expect(p.sections.inventory!.created).toBe(510);
    expect(p.sections.history!.created).toBe(50 * 365);
    expect(previewMs).toBeLessThan(3000);
  });
});
