import { afterEach, describe, expect, it } from 'vitest';
import type { ImportPreview, ImportResult } from '../src/application/devices/csv-import-service';
import { BOM } from '../src/domain/csv';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});
async function harness() {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const call = async <T>(url: string, payload: object) => {
    const r = await h.inject({ method: 'POST', url, cookie, payload });
    return { status: r.statusCode, body: r.json<T>() };
  };
  return { h, cookie, call };
}

const count = (h: ApiHarness, table: string) =>
  h.services.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;

const FIVE_ROWS = [
  'nome;mac;ip;sala;tags',
  'PC-01;00:AA:00:00:00:01;10.0.3.21;Lab 3;professor',
  'PC-02;00-AA-00-00-00-02;10.0.3.22;Lab 3;',
  'PC-03;00aa.0000.0003;;Lab 4;manhã|Win11',
  'PC-04;nao-e-mac;10.0.3.24;Lab 3;',
  'PC-05;00:AA:00:00:00:99;10.0.3.25;Lab 3;',
].join('\n');

describe('CSV import (FR-002.3)', () => {
  it('AC-002-08 preview: 3 OK, 1 error with line and reason, 1 duplicate with the chosen action; nothing written', async () => {
    const { h, call } = await harness();
    await call('/api/devices', { name: 'Existente', mac: '00:AA:00:00:00:99' });
    const before = {
      devices: count(h, 'devices'),
      rooms: count(h, 'rooms'),
      tags: count(h, 'tags'),
    };

    const r = await call<ImportPreview>('/api/devices/import/preview', {
      csv: FIVE_ROWS,
      onDuplicate: 'skip',
    });
    expect(r.status).toBe(200);
    expect(r.body.summary).toEqual({ create: 3, update: 0, skip: 1, error: 1 });
    expect(r.body.rows.find((x) => x.status === 'error')).toMatchObject({
      line: 5,
      name: 'PC-04',
      reasons: [expect.stringContaining('MAC inválido')],
    });
    expect(r.body.rows.find((x) => x.status === 'skip')).toMatchObject({
      line: 6,
      reasons: ['MAC já cadastrado em "Existente".'],
    });
    expect(r.body.roomsToCreate.sort()).toEqual(['Lab 3', 'Lab 4']);
    expect(r.body.tagsToCreate.sort()).toEqual(['Win11', 'manhã', 'professor']);
    expect({
      devices: count(h, 'devices'),
      rooms: count(h, 'rooms'),
      tags: count(h, 'tags'),
    }).toEqual(before);

    const asUpdate = await call<ImportPreview>('/api/devices/import/preview', {
      csv: FIVE_ROWS,
      onDuplicate: 'update',
    });
    expect(asUpdate.body.summary).toEqual({ create: 3, update: 1, skip: 0, error: 1 });
  });

  it('commit creates rooms, tags and devices in one transaction and one audit entry', async () => {
    const { h, cookie, call } = await harness();
    const r = await call<ImportResult>('/api/devices/import/commit', { csv: FIVE_ROWS });
    expect(r.body).toEqual({
      created: 4,
      updated: 0,
      skipped: 0,
      errors: 1,
      roomsCreated: ['Lab 3', 'Lab 4'],
      tagsCreated: ['professor', 'manhã', 'Win11'],
    });
    expect(count(h, 'devices')).toBe(4);
    const lab4 = h.services.rooms.list().find((x) => x.name === 'Lab 4');
    expect(lab4).toMatchObject({ code: 'LAB4', deviceCount: 1 });
    const pc3 = (await h.inject({ url: '/api/devices?q=PC-03', cookie })).json<{
      items: { tagIds: number[]; mac: string }[];
    }>();
    expect(pc3.items[0]).toMatchObject({ mac: '00:AA:00:00:00:03' });
    expect(pc3.items[0]?.tagIds).toHaveLength(2);
    expect(h.services.audit.query({ action: 'device.import' }).total).toBe(1);
    expect(h.services.audit.query({ action: 'device.create' }).total).toBe(0);
  });

  it('updates existing devices only in the columns present in the file', async () => {
    const { h, cookie, call } = await harness();
    const room = (await call<{ id: number }>('/api/rooms', { name: 'Lab 1' })).body;
    await call('/api/devices', {
      name: 'Velho',
      mac: '00:AA:00:00:00:10',
      ip: '10.0.0.10',
      roomId: room.id,
      notes: 'manter',
    });
    const csv = 'nome,mac,ip\nNovo nome,00:aa:00:00:00:10,10.0.0.11\n';
    const r = await call<ImportResult>('/api/devices/import/commit', {
      csv,
      onDuplicate: 'update',
    });
    expect(r.body).toMatchObject({ created: 0, updated: 1 });
    const d = (await h.inject({ url: '/api/devices?q=10.0.0.11', cookie })).json<{
      items: { name: string; roomId: number; notes: string }[];
    }>().items[0];
    expect(d).toMatchObject({ name: 'Novo nome', roomId: room.id, notes: 'manter' });
  });

  it('with createMissing=false, unknown rooms/tags are row errors; repeated MACs in the file are errors', async () => {
    const { call } = await harness();
    const csv =
      'nome;mac;sala;tags\nA;00:AA:00:00:00:21;Nova;\nB;00:AA:00:00:00:22;;nova-tag\nC;00:AA:00:00:00:23;;\nD;00-aa-00-00-00-23;;\n';
    const r = await call<ImportPreview>('/api/devices/import/preview', {
      csv,
      createMissing: false,
    });
    expect(r.body.summary).toEqual({ create: 1, update: 0, skip: 0, error: 3 });
    expect(r.body.rows.map((x) => x.reasons.join(' '))).toEqual([
      'Sala "Nova" não existe.',
      'Etiqueta "nova-tag" não existe.',
      '',
      'MAC repetido no arquivo (linha 4).',
    ]);
  });

  it('rejects unreadable files with CSV_INVALID and invalid ativo values per row', async () => {
    const { call } = await harness();
    const bad = await call<{ code: string; message: string }>('/api/devices/import/preview', {
      csv: 'ip;sala\n1;2\n',
    });
    expect(bad.status).toBe(422);
    expect(bad.body).toMatchObject({
      code: 'CSV_INVALID',
      message: expect.stringContaining('"nome" e "mac"'),
    });
    const ativo = await call<ImportPreview>('/api/devices/import/preview', {
      csv: 'nome;mac;ativo\nA;00:AA:00:00:00:31;talvez\n',
    });
    expect(ativo.body.rows[0]?.reasons).toEqual([
      'Valor de "ativo" não reconhecido (use sim ou não).',
    ]);
  });
});

describe('CSV export (FR-002.3)', () => {
  it('serves ; separated UTF-8 with BOM as an attachment', async () => {
    const { h, cookie, call } = await harness();
    await call('/api/devices', { name: '=SOMA(1)', mac: '00:AA:00:00:00:41' });
    const r = await h.inject({ url: '/api/devices/export.csv', cookie });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toMatch(
      /^attachment; filename="uniwake-dispositivos-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(r.body.startsWith(BOM)).toBe(true);
    expect(r.body).toContain("'=SOMA(1);00:AA:00:00:00:41");
  });

  it('AC-002-10 export then import into an empty database yields identical devices, rooms and tags', async () => {
    const src = await harness();
    const lab = (await src.call<{ id: number }>('/api/rooms', { name: 'Laboratório 3' })).body;
    const t1 = (await src.call<{ id: number }>('/api/tags', { name: 'professor' })).body;
    const t2 = (await src.call<{ id: number }>('/api/tags', { name: 'manhã' })).body;
    await src.call('/api/devices', {
      name: '@Prof',
      mac: '00:AA:00:00:00:51',
      ip: '10.0.3.51',
      hostname: 'LAB3-PROF',
      roomId: lab.id,
      tagIds: [t1.id, t2.id],
      notes: 'Mesa; "frente"',
    });
    await src.call('/api/devices', { name: 'Solto', mac: '00:AA:00:00:00:52', enabled: false });
    const csv = (await src.h.inject({ url: '/api/devices/export.csv', cookie: src.cookie })).body;

    const dst = await harness();
    const r = await dst.call<ImportResult>('/api/devices/import/commit', { csv });
    expect(r.body).toMatchObject({ created: 2, errors: 0 });

    const snapshot = (h: ApiHarness) => {
      const rooms = new Map(h.services.rooms.list().map((x) => [x.id, x.name]));
      const tags = new Map(h.services.tags.list().map((x) => [x.id, x.name]));
      const list = h.services.devices.list({ page: 1, pageSize: 200 });
      const items = 'items' in list ? list.items : [];
      return {
        rooms: [...rooms.values()].sort(),
        tags: [...tags.values()].sort(),
        devices: items.map((d) => ({
          name: d.name,
          mac: d.mac,
          ip: d.ip,
          hostname: d.hostname,
          room: d.roomId === null ? null : rooms.get(d.roomId),
          tags: d.tagIds.map((t) => tags.get(t)).sort(),
          notes: d.notes,
          enabled: d.enabled,
        })),
      };
    };
    expect(snapshot(dst.h)).toEqual(snapshot(src.h));
  });
});
