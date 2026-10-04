import { afterEach, describe, expect, it } from 'vitest';
import { baseRoomCode, ROOM_CODE_RE, suggestRoomCode } from '../src/domain/room-code';
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

describe('room codes (FR-008.1)', () => {
  it('AC-008-02 suggests LAB3 for "Lab 3" and LAB3-2 when taken', () => {
    expect(baseRoomCode('Lab 3')).toBe('LAB3');
    const taken = new Set(['LAB3']);
    expect(suggestRoomCode('Lab 3', (c) => taken.has(c))).toBe('LAB3-2');
    taken.add('LAB3-2');
    expect(suggestRoomCode('Lab 3', (c) => taken.has(c))).toBe('LAB3-3');
  });

  it('strips accents, uses initials for long names and always matches the code pattern', () => {
    expect(baseRoomCode('Laboratório de Informática 2')).toBe('LDI2');
    expect(baseRoomCode('Sala 101')).toBe('SALA101');
    expect(baseRoomCode('A')).toBe('SALAA');
    expect(baseRoomCode('***')).toBe('SALA');
    const long = 'Z'.repeat(40);
    const all = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const c = suggestRoomCode(long, (x) => all.has(x));
      expect(c).toMatch(ROOM_CODE_RE);
      all.add(c);
    }
  });
});

describe('rooms API (FR-008.1)', () => {
  it('creates, reads, updates and lists rooms in block → floor → name order', async () => {
    const { h, cookie } = await harness();
    const create = (payload: object) =>
      h.inject({ method: 'POST', url: '/api/rooms', cookie, payload });
    const lab3 = await create({
      name: 'Lab 3',
      block: 'B',
      floor: '1',
      color: '#FF0000',
      batchDelaySeconds: 8,
    });
    expect(lab3.statusCode).toBe(201);
    expect(lab3.json()).toMatchObject({
      name: 'Lab 3',
      code: 'LAB3',
      block: 'B',
      color: '#ff0000',
      batchDelaySeconds: 8,
      deviceCount: 0,
    });
    await create({ name: 'Lab 1', block: 'A', floor: '2' });
    await create({ name: 'Biblioteca' });
    const list = (await h.inject({ url: '/api/rooms', cookie })).json<{ name: string }[]>();
    expect(list.map((r) => r.name)).toEqual(['Lab 1', 'Lab 3', 'Biblioteca']);

    const id = lab3.json<{ id: number }>().id;
    const upd = await h.inject({
      method: 'PATCH',
      url: `/api/rooms/${id}`,
      cookie,
      payload: { name: 'Lab 3 (novo)', block: '' },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ name: 'Lab 3 (novo)', code: 'LAB3', block: null });
    expect((await h.inject({ url: '/api/rooms/999', cookie })).statusCode).toBe(404);
    expect(h.services.audit.query({ actionPrefix: 'room.' }).total).toBe(4);
  });

  it('rejects duplicate names (case-insensitive) and codes', async () => {
    const { h, cookie } = await harness();
    await h.inject({ method: 'POST', url: '/api/rooms', cookie, payload: { name: 'Lab 3' } });
    const dupName = await h.inject({
      method: 'POST',
      url: '/api/rooms',
      cookie,
      payload: { name: 'LAB 3' },
    });
    expect(dupName.statusCode).toBe(409);
    expect(dupName.json()).toMatchObject({ code: 'ROOM_NAME_DUPLICATE' });
    const dupCode = await h.inject({
      method: 'POST',
      url: '/api/rooms',
      cookie,
      payload: { name: 'Outra', code: 'lab3' },
    });
    expect(dupCode.json()).toMatchObject({
      code: 'ROOM_CODE_DUPLICATE',
      message: expect.stringContaining('LAB3'),
    });
    const auto = await h.inject({
      method: 'POST',
      url: '/api/rooms',
      cookie,
      payload: { name: 'Lab-3' },
    });
    expect(auto.json()).toMatchObject({ code: 'LAB3-2' });
    const bad = await h.inject({
      method: 'POST',
      url: '/api/rooms',
      cookie,
      payload: { name: 'X', code: 'has space' },
    });
    expect(bad.statusCode).toBe(422);
  });

  it('AC-008-01 deleting a room with 4 devices needs confirmation and moves them to "Sem sala"', async () => {
    const { h, cookie } = await harness();
    const room = (
      await h.inject({ method: 'POST', url: '/api/rooms', cookie, payload: { name: 'Lab 3' } })
    ).json<{ id: number }>();
    for (let i = 0; i < 4; i++) {
      h.services.db.run(
        'INSERT INTO devices (name, mac, room_id, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
        [`PC-${i}`, `00:11:22:33:44:0${i}`, room.id],
      );
    }
    const impact = await h.inject({ url: `/api/rooms/${room.id}/delete-impact`, cookie });
    expect(impact.json()).toEqual({ deviceCount: 4, schedules: [] });

    const noConfirm = await h.inject({ method: 'DELETE', url: `/api/rooms/${room.id}`, cookie });
    expect(noConfirm.statusCode).toBe(409);
    expect(noConfirm.json()).toMatchObject({
      code: 'DELETE_CONFIRMATION_REQUIRED',
      details: { deviceCount: 4 },
    });

    const ok = await h.inject({
      method: 'DELETE',
      url: `/api/rooms/${room.id}?confirm=true`,
      cookie,
    });
    expect(ok.statusCode).toBe(204);
    const orphans = h.services.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM devices WHERE room_id IS NULL',
    );
    expect(orphans?.n).toBe(4);
    expect(h.services.audit.query({ action: 'room.delete' }).items[0]?.details).toMatchObject({
      movedToNoRoom: 4,
    });
  });

  it('AC-008-03 the delete confirmation lists schedules that target the room', async () => {
    const { h, cookie } = await harness();
    const room = (
      await h.inject({ method: 'POST', url: '/api/rooms', cookie, payload: { name: 'Lab 3' } })
    ).json<{ id: number }>();
    const sid = h.services.db.run(
      "INSERT INTO schedules (name, weekdays, time_local, timezone, created_at, updated_at) VALUES ('Manhã', 31, '06:50', 'America/Sao_Paulo', 0, 0)",
    ).lastInsertRowid;
    h.services.db.run(
      "INSERT INTO schedule_targets (schedule_id, type, ref_id) VALUES (?, 'room', ?)",
      [sid, room.id],
    );
    const r = await h.inject({ method: 'DELETE', url: `/api/rooms/${room.id}`, cookie });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({
      details: { deviceCount: 0, schedules: [{ id: sid, name: 'Manhã' }] },
    });
  });

  it('an empty room is deleted without confirmation', async () => {
    const { h, cookie } = await harness();
    const room = (
      await h.inject({ method: 'POST', url: '/api/rooms', cookie, payload: { name: 'Vazia' } })
    ).json<{ id: number }>();
    expect(
      (await h.inject({ method: 'DELETE', url: `/api/rooms/${room.id}`, cookie })).statusCode,
    ).toBe(204);
  });
});
