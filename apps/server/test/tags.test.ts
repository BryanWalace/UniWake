import { afterEach, describe, expect, it } from 'vitest';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});
async function harness() {
  const h = await apiHarness();
  hs.push(h);
  return { h, cookie: await h.as('operator') };
}

describe('tags API (FR-008.2)', () => {
  it('creates, renames, recolors and lists tags alphabetically with device counts', async () => {
    const { h, cookie } = await harness();
    const post = (payload: object) =>
      h.inject({ method: 'POST', url: '/api/tags', cookie, payload });
    const prof = await post({ name: 'professor', color: '#AA0000' });
    expect(prof.statusCode).toBe(201);
    expect(prof.json()).toEqual({
      id: expect.any(Number),
      name: 'professor',
      color: '#aa0000',
      deviceCount: 0,
    });
    await post({ name: 'Projetor' });
    await post({ name: 'manhã' });
    const names = (await h.inject({ url: '/api/tags', cookie }))
      .json<{ name: string }[]>()
      .map((t) => t.name);
    expect(names).toEqual(['manhã', 'professor', 'Projetor']);

    const id = prof.json<{ id: number }>().id;
    const upd = await h.inject({
      method: 'PATCH',
      url: `/api/tags/${id}`,
      cookie,
      payload: { name: 'docente' },
    });
    expect(upd.json()).toMatchObject({ name: 'docente', color: '#aa0000' });
  });

  it('rejects duplicate names case-insensitively and names over 32 chars', async () => {
    const { h, cookie } = await harness();
    await h.inject({ method: 'POST', url: '/api/tags', cookie, payload: { name: 'Win11' } });
    const dup = await h.inject({
      method: 'POST',
      url: '/api/tags',
      cookie,
      payload: { name: 'win11' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ code: 'TAG_NAME_DUPLICATE' });
    const long = await h.inject({
      method: 'POST',
      url: '/api/tags',
      cookie,
      payload: { name: 'x'.repeat(33) },
    });
    expect(long.statusCode).toBe(422);
  });

  it('AC-008-04 deleting tag T removes it from its 5 devices and the tag is gone', async () => {
    const { h, cookie } = await harness();
    const tag = (
      await h.inject({ method: 'POST', url: '/api/tags', cookie, payload: { name: 'professor' } })
    ).json<{ id: number }>();
    for (let i = 0; i < 5; i++) {
      const dev = h.services.db.run(
        'INSERT INTO devices (name, mac, created_at, updated_at) VALUES (?, ?, 0, 0)',
        [`PC-${i}`, `00:11:22:33:44:1${i}`],
      ).lastInsertRowid;
      h.services.db.run('INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)', [dev, tag.id]);
    }
    expect((await h.inject({ url: `/api/tags/${tag.id}/delete-impact`, cookie })).json()).toEqual({
      deviceCount: 5,
      schedules: [],
    });
    expect(
      (await h.inject({ method: 'DELETE', url: `/api/tags/${tag.id}`, cookie })).statusCode,
    ).toBe(204);
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM device_tags')?.n).toBe(0);
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(5);
    expect((await h.inject({ url: '/api/tags', cookie })).json()).toEqual([]);
  });

  it('a tag targeted by a schedule needs confirmation to delete', async () => {
    const { h, cookie } = await harness();
    const tag = (
      await h.inject({ method: 'POST', url: '/api/tags', cookie, payload: { name: 'manhã' } })
    ).json<{ id: number }>();
    const sid = h.services.db.run(
      "INSERT INTO schedules (name, weekdays, time_local, timezone, created_at, updated_at) VALUES ('Cedo', 31, '06:50', 'America/Sao_Paulo', 0, 0)",
    ).lastInsertRowid;
    h.services.db.run(
      "INSERT INTO schedule_targets (schedule_id, type, ref_id) VALUES (?, 'tag', ?)",
      [sid, tag.id],
    );
    const r = await h.inject({ method: 'DELETE', url: `/api/tags/${tag.id}`, cookie });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({
      code: 'DELETE_CONFIRMATION_REQUIRED',
      details: { schedules: [{ name: 'Cedo' }] },
    });
    expect(
      (await h.inject({ method: 'DELETE', url: `/api/tags/${tag.id}?confirm=true`, cookie }))
        .statusCode,
    ).toBe(204);
  });
});
