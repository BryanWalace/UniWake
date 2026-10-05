import { afterEach, describe, expect, it } from 'vitest';
import type { AuditRow, Page } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) {
    for (let i = 0; i < 400 && h.services.runner.activeCount > 0; i++)
      await h.clock.advanceAsync(5_000);
    await h.close();
  }
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const get = async <T>(url: string) => (await h.inject({ url, cookie })).json<T>();
  return { h, cookie, get };
}

describe('audit (FR-006.5)', () => {
  it('AC-006-06: a room wake by user U is audited as wake.start on room:Lab 3, then wake.finish with counts', async () => {
    const { h, cookie, get } = await setup();
    const room = h.services.rooms.create({ name: 'Lab 3' }, ACTOR).id;
    for (let i = 0; i < 3; i++) {
      h.services.devices.create(
        { name: `PC-${i}`, mac: `00:AB:00:00:00:0${i}`, roomId: room, ip: `10.0.3.${i + 40}` },
        ACTOR,
      );
    }
    h.ports.prober.setAlive('10.0.3.40');
    const r = await h.inject({
      method: 'POST',
      url: '/api/wake',
      cookie,
      payload: { target: { type: 'rooms', roomIds: [room] } },
    });
    expect(r.statusCode).toBe(202);
    for (let i = 0; i < 400 && h.services.runner.activeCount > 0; i++)
      await h.clock.advanceAsync(5_000);

    const page = await get<Page<AuditRow>>('/api/audit?action=wake.');
    const start = page.items.find((a) => a.action === 'wake.start')!;
    const finish = page.items.find((a) => a.action === 'wake.finish')!;
    expect(start).toMatchObject({
      actorLabel: 'operator-user',
      target: 'room:Lab 3',
      details: { count: 3 },
    });
    expect(start.actorUserId).toEqual(expect.any(Number));
    expect(finish).toMatchObject({
      actorLabel: 'operator-user',
      target: 'room:Lab 3',
      result: 'ok',
    });
    expect(finish.details).toMatchObject({
      total: 3,
      woke: expect.any(Number),
      noResponse: expect.any(Number),
    });
    expect(page.items.indexOf(finish)).toBeLessThan(page.items.indexOf(start)); // newest first
  });

  it('filters by action, result, actor and free text, and pages', async () => {
    const { h, get } = await setup();
    for (const name of ['Lab A', 'Lab B', 'Biblioteca']) h.services.rooms.create({ name }, ACTOR);
    await h.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'intruso', password: 'nao-sei-nao-1' },
    });
    const denied = await get<Page<AuditRow>>('/api/audit?result=denied');
    expect(denied.items.map((a) => a.actorLabel)).toEqual(['intruso']);
    const labs = await get<Page<AuditRow>>('/api/audit?action=room.create&q=Lab');
    expect(labs.total).toBe(2);
    const paged = await get<Page<AuditRow>>('/api/audit?action=room.&pageSize=2&page=2');
    expect(paged).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(paged.items).toHaveLength(1);
    const literal = await get<Page<AuditRow>>('/api/audit?q=%25');
    expect(literal.total).toBe(0); // "%" is matched literally, not as a wildcard
  });

  it('exports CSV with local times, a BOM and neutralized formulas', async () => {
    const { h, cookie } = await setup();
    // Logins no longer store such values (R-M6-02); the export must neutralize any stored cell.
    h.services.audit.record({
      actor: { id: null, label: '=cmd|calc' },
      action: 'auth.login',
      result: 'denied',
      sourceIp: '127.0.0.1',
    });
    const r = await h.inject({ url: '/api/audit/export.csv?result=denied', cookie });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toMatch(/uniwake-auditoria-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = r.body.split('\r\n');
    expect(lines[0]).toBe('﻿quando;usuario;acao;alvo;resultado;ip;detalhes');
    expect(lines[1]).toMatch(/^05\/10\/2026 06:00:00;'=cmd\|calc;auth\.login;;negado;/);
  });
});
