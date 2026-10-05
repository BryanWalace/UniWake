/** M6-D break-it pass (tasks.md checklist): auth, users, settings, LAN, logs, health, backups. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, type Config, dataPaths } from '../src/config';
import { createHub, type Hub } from '../src/hub';
import { createServices } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { apiHarness, type ApiHarness, TEST_PASSWORD } from './helpers/api';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const dirs: string[] = [];
const hubs: Hub[] = [];
const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hubs.splice(0)) await h.stop();
  for (const h of hs.splice(0)) await h.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-m6d-'));
  dirs.push(d);
  return d;
};
const silent = pino({ level: 'silent' });
const config = (dataDir: string): Config => ({
  ...CONFIG_DEFAULTS,
  panelPort: 0,
  agentPort: 0,
  agentBind: '127.0.0.1',
  dataDir,
  demo: false,
});

function testPfx(): Buffer | null {
  const d = tempDir();
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=t',
        '-keyout',
        join(d, 'k.pem'),
        '-out',
        join(d, 'c.pem'),
      ],
      { stdio: 'ignore' },
    );
    execFileSync(
      'openssl',
      [
        'pkcs12',
        '-export',
        '-inkey',
        join(d, 'k.pem'),
        '-in',
        join(d, 'c.pem'),
        '-out',
        join(d, 'p.pfx'),
        '-passout',
        'pass:x',
      ],
      { stdio: 'ignore' },
    );
    return readFileSync(join(d, 'p.pfx'));
  } catch {
    return null;
  }
}

describe('M6-D: malformed input on the admin endpoints', () => {
  it('rejects bad bodies with 4xx and never pollutes prototypes', async () => {
    const h = await apiHarness();
    hs.push(h);
    const admin = await h.as('admin');
    const call = (method: 'POST' | 'PATCH' | 'GET', url: string, payload?: unknown) =>
      h.inject({
        method,
        url,
        cookie: admin,
        ...(payload !== undefined ? { payload: payload as object } : {}),
      });
    for (const [method, url, body] of [
      ['POST', '/api/users', { username: 'a b', password: 'mesa-azul-do-lab', role: 'operator' }],
      [
        'POST',
        '/api/users',
        { username: 'x'.repeat(1000), password: 'mesa-azul-do-lab', role: 'operator' },
      ],
      ['POST', '/api/users', { username: 'joao', password: 'mesa-azul-do-lab', role: 'root' }],
      ['PATCH', '/api/settings', JSON.parse('{"__proto__": {"polluted": true}}')],
      ['PATCH', '/api/settings', { constructor: { prototype: { polluted: true } } }],
      ['POST', '/api/settings/certificate', { pfxBase64: 'x'.repeat(250_000), password: '' }],
      ['POST', '/api/auth/password', {}],
      ['GET', `/api/logs?q=${'x'.repeat(500)}`, undefined],
      ['GET', `/api/audit?q=${'x'.repeat(500)}`, undefined],
    ] as const) {
      const r = await call(method, url, body);
      expect(
        r.statusCode,
        `${method} ${url} ${JSON.stringify(body)?.slice(0, 60)}`,
      ).toBeGreaterThanOrEqual(400);
      expect(r.statusCode).toBeLessThan(500);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('M6-D: a wrong LAN address', () => {
  it.skipIf(!testPfx())(
    'the hub still starts on loopback and explains the LAN problem',
    async () => {
      const dir = tempDir();
      const first = await createHub({ config: config(dir), logger: silent });
      // An address this computer does not have (TEST-NET-1, RFC 5737).
      first.services.settings.update(
        { 'panel.lanEnabled': true, 'panel.lanAddress': '192.0.2.10' },
        null,
      );
      await first.stop();
      const pfx = testPfx()!;
      const hub = await createHub({
        config: config(dir),
        logger: silent,
        panelCertificate: () => Promise.resolve({ pfx, passphrase: 'x' }),
      });
      hubs.push(hub);
      await hub.start(); // must not throw
      expect(hub.addresses().panel.startsWith('127.0.0.1:')).toBe(true);
      expect(hub.addresses().panelLan).toBeUndefined();
      const notice = hub.services.notices.list().find((n) => n.type === 'lan_error');
      expect(String(notice?.data.message)).toMatch(/192\.0\.2\.10/);
    },
  );
});

describe('M6-D: backwards clock jumps', () => {
  it('a login failure stamped in the "future" does not lock the account for the size of the jump', async () => {
    const h = await apiHarness();
    hs.push(h);
    await h.createUser('ana', 'operator');
    const login = (password: string) =>
      h.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ana', password } });
    for (let i = 0; i < 5; i++) await login('errada-123456');
    h.clock.jump(-3_600_000); // NTP corrects the clock one hour back
    h.clock.advance(31_000);
    expect((await login(TEST_PASSWORD)).statusCode).toBe(200);
  });
});

describe('M6-D: the same action twice', () => {
  it('two backups in the same second both succeed', () => {
    const db = testDb();
    const clock = new FakeClock(T0);
    const s = createServices(db, clock, fakePorts(clock), { backupsDir: tempDir() });
    const a = s.backups!.create('manual');
    const b = s.backups!.create('manual');
    expect(a.file).not.toBe(b.file);
    expect(s.backups!.list()).toHaveLength(2);
    db.close();
  });

  it('two concurrent creates of one username: one wins', async () => {
    const h = await apiHarness();
    hs.push(h);
    const admin = await h.as('admin');
    const create = () =>
      h.inject({
        method: 'POST',
        url: '/api/users',
        cookie: admin,
        payload: { username: 'maria', password: 'mesa-azul-do-lab', role: 'operator' },
      });
    const codes = (await Promise.all([create(), create()])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);
  });

  it('two admins demoting each other at once still leave one admin', async () => {
    const h = await apiHarness();
    hs.push(h);
    const a = await h.as('admin');
    await h.createUser('vice', 'admin');
    const b = await h.login('vice');
    const ids = Object.fromEntries(h.services.users.list().map((u) => [u.username, u.id]));
    const demote = (cookie: string, id: number) =>
      h.inject({ method: 'PATCH', url: `/api/users/${id}`, cookie, payload: { role: 'operator' } });
    await Promise.all([demote(a, ids.vice!), demote(b, ids['admin-user']!)]);
    expect(h.services.users.list().filter((u) => u.role === 'admin' && u.enabled)).toHaveLength(1);
  });
});

describe('M6-D: a restore whose backup disappeared before the restart', () => {
  it('starts on the current database and tells the admin the restore did not happen', async () => {
    const dir = tempDir();
    const first = await createHub({
      config: config(dir),
      logger: silent,
      requestRestart: () => undefined,
    });
    first.services.rooms.create({ name: 'Atual' }, { id: null, label: 't' });
    const b = first.services.backups!.create('manual');
    first.services.backups!.restore(
      b.id,
      '05/10/2026'.replace(/.*/, () => {
        const d = new Date(b.createdAt);
        return new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(d);
      }),
      { id: 1, label: 'admin' },
    );
    await first.stop();
    rmSync(join(dataPaths(dir).backups, b.file)); // antivirus, a technician, a full disk...
    const second = await createHub({ config: config(dir), logger: silent });
    hubs.push(second);
    expect(second.services.rooms.list().map((r) => r.name)).toEqual(['Atual']);
    expect(second.services.notices.list().map((n) => n.type)).toContain('restore_failed');
  });
});
