import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app';
import { LOOPBACK_HOSTS } from '../src/http/security';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

describe('M2 review fixes', () => {
  it('R-M2-01 malformed URLs return the catalog error shape in pt-BR', async () => {
    const app = await buildApp({
      kind: 'panel',
      hosts: () => new Set(LOOPBACK_HOSTS),
      register: () => undefined,
    });
    const r = await app.inject({ url: '/salas/%ZZ' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('Dados inválidos'),
    });
    await app.close();
  });

  it('R-M2-05 a foreign key violation is a 422, not a 500', async () => {
    const app = await buildApp({
      kind: 'panel',
      hosts: () => new Set(LOOPBACK_HOSTS),
      register: (a) => {
        a.get('/api/fk', { config: { auth: 'public' } }, async () => {
          const e = new Error('FOREIGN KEY constraint failed');
          e.name = 'ForeignKeyError';
          throw e;
        });
      },
    });
    const r = await app.inject({ url: '/api/fk' });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    await app.close();
  });

  it('R-M2-02 the export filename uses the configured time zone date', async () => {
    const h = await apiHarness();
    hs.push(h);
    h.services.settings.update({ 'scheduler.timezone': 'Pacific/Kiritimati' }, null); // UTC+14
    const r = await h.inject({ url: '/api/devices/export.csv', cookie: await h.as('operator') });
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Kiritimati',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(r.headers['content-disposition']).toContain(`uniwake-dispositivos-${expected}.csv`);
  });
});
