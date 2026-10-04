/**
 * M1-D break-it pass (tasks.md checklist). Each probe documents an attack or failure and the
 * expected safe behavior; failures found here become M1-F tasks.
 */
import { spawn } from 'node:child_process';
import dns from 'node:dns';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, dataPaths } from '../src/config';
import { Db } from '../src/db/connection';
import { createHub } from '../src/hub';
import { SESSION_COOKIE } from '../src/http/session-auth';
import { apiHarness, type ApiHarness, TEST_PASSWORD } from './helpers/api';
import { NetworkGuardError } from './setup/network-guard';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
async function harness(): Promise<ApiHarness> {
  const h = await apiHarness();
  cleanups.push(() => h.close());
  return h;
}
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-breakit-'));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

describe('M1-D: malformed and hostile input', () => {
  it('X-Forwarded-For cannot make a remote setup look local (trustProxy is off)', async () => {
    const h = await harness();
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      remoteAddress: '10.0.3.77',
      headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' },
      payload: { username: 'intruso', password: TEST_PASSWORD },
    });
    expect(r.statusCode).toBe(403);
    expect(h.services.auth.needsSetup()).toBe(true);
  });

  it('rejects prototype-pollution payloads without polluting Object.prototype', async () => {
    const h = await harness();
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"username":"a","password":"b","__proto__":{"polluted":true}}',
    });
    expect(r.statusCode).toBe(422);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('unsupported content types, missing Host, huge cookies and oversized fields fail safely', async () => {
    const h = await harness();
    const text = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'username=a&password=b',
    });
    expect(text.statusCode).toBe(422);
    expect(text.json()).toMatchObject({ code: 'VALIDATION_FAILED' });

    const bigCookie = await h.inject({
      url: '/api/auth/me',
      cookie: `${SESSION_COOKIE}=${'a'.repeat(4000)}`,
    });
    expect(bigCookie.statusCode).toBe(401);

    const longUser = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'u'.repeat(10_000), password: 'x' },
    });
    expect(longUser.statusCode).toBe(422);
  });

  it('the same user can log in twice in parallel; both sessions work and are independent', async () => {
    const h = await harness();
    await h.createUser('ana', 'operator');
    const [a, b] = await Promise.all([h.login('ana'), h.login('ana')]);
    expect(a).not.toBe(b);
    await h.inject({ method: 'POST', url: '/api/auth/logout', cookie: a });
    expect((await h.inject({ url: '/api/auth/me', cookie: a })).statusCode).toBe(401);
    expect((await h.inject({ url: '/api/auth/me', cookie: b })).statusCode).toBe(200);
  });

  it('clock jumps (NTP corrections) neither crash nor extend sessions beyond the absolute limit', async () => {
    const h = await harness();
    const cookie = await h.as('operator');
    h.clock.jump(-3_600_000); // clock goes back 1 h
    expect((await h.inject({ url: '/api/auth/me', cookie })).statusCode).toBe(200);
    h.clock.jump(2 * 3_600_000); // forward 2 h
    expect((await h.inject({ url: '/api/auth/me', cookie })).statusCode).toBe(200);
    h.clock.jump(8 * 86_400_000); // CMOS reset into the future
    expect((await h.inject({ url: '/api/auth/me', cookie })).statusCode).toBe(401);
  });
});

describe('M1-D: requests without a Host header (HTTP/1.0)', () => {
  it('are rejected by the panel Host allowlist', async () => {
    const dir = tempDir();
    const hub = await createHub({
      config: {
        ...CONFIG_DEFAULTS,
        dataDir: dir,
        demo: false,
        panelPort: 0,
        agentPort: 0,
        agentBind: '127.0.0.1',
      },
      logger: pino({ level: 'silent' }),
    });
    cleanups.push(() => hub.stop());
    await hub.start();
    const [host, port] = hub.addresses().panel.split(':');
    const sock = net.connect(Number(port), host);
    await once(sock, 'connect');
    const CRLF = '\r\n';
    sock.write(`GET /api/health HTTP/1.0${CRLF}${CRLF}`);
    let response = '';
    sock.on('data', (d: Buffer) => (response += d.toString()));
    await once(sock, 'end');
    expect(response.split(CRLF)[0]).toMatch(/^HTTP\/1\.[01] 421/);
  });
});

describe('M1-D: no real network from tests (constitution §5)', () => {
  it('DNS lookups of non-loopback names are blocked by the guard', async () => {
    await expect(dns.promises.lookup('example.com')).rejects.toBeInstanceOf(NetworkGuardError);
    await expect(dns.promises.resolve4('example.com')).rejects.toBeInstanceOf(NetworkGuardError);
    expect(() => dns.lookup('example.com', () => undefined)).toThrow(NetworkGuardError);
    expect(await dns.promises.lookup('localhost')).toBeTruthy();
  });
});

describe('M1-D: crashes and damaged data', () => {
  it('kill -9 during continuous writes leaves a consistent database (WAL + synchronous=FULL)', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'crash.db');
    const script = join(dir, 'writer.ts');
    const dbModule = pathToFileURL(
      join(import.meta.dirname, '..', 'src', 'db', 'connection.ts'),
    ).href;
    writeFileSync(
      script,
      `import { Db } from '${dbModule}';
       const db = new Db(${JSON.stringify(dbPath)});
       db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL)');
       console.log('ready');
       for (let i = 0; ; i++) {
         db.transaction(() => { db.run('INSERT INTO t (a, b) VALUES (?, ?)', [i, i]); db.run('UPDATE t SET b = b + 1 WHERE id = (SELECT MAX(id) FROM t)'); });
       }`,
    );
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const started = await Promise.race([
      once(child.stdout, 'data').then(() => true),
      once(child, 'exit').then(() => false),
    ]);
    expect(started, stderr).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    child.kill('SIGKILL');
    await once(child, 'exit');

    const db = new Db(dbPath);
    try {
      expect(db.get<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check).toBe(
        'ok',
      );
      const rows = db.get<{ n: number; bad: number }>(
        'SELECT COUNT(*) AS n, SUM(b != a + 1) AS bad FROM t',
      );
      expect(rows?.n).toBeGreaterThan(0);
      expect(rows?.bad).toBe(0); // no half-applied transaction
    } finally {
      db.close();
    }
  });

  it('a corrupt database file stops the hub with a clear, actionable error', async () => {
    const dir = tempDir();
    const paths = dataPaths(dir);
    mkdirSync(paths.dbDir, { recursive: true });
    writeFileSync(paths.db, 'this is not a database'.repeat(100));
    const err = await createHub({
      config: { ...CONFIG_DEFAULTS, dataDir: dir, demo: false, panelPort: 0, agentPort: 0 },
      logger: pino({ level: 'silent' }),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/banco de dados|database/i);
    expect((err as Error).message).toMatch(/backup/i);
  });
});

describe('M1-D: logs contain no secrets', () => {
  it('setup, login failures and successes never log passwords or session tokens', async () => {
    const dir = tempDir();
    let out = '';
    const sink = new Writable({
      write(chunk: Buffer, _e, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const hub = await createHub({
      config: { ...CONFIG_DEFAULTS, dataDir: dir, demo: false, panelPort: 0, agentPort: 0 },
      logger: pino({ level: 'debug' }, sink),
    });
    cleanups.push(() => hub.stop());
    await hub.panel.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'admin', password: 'Segredo-Setup-123' },
    });
    await hub.panel.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'Senha-Errada-456' },
    });
    const ok = await hub.panel.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'Segredo-Setup-123' },
    });
    const token = ok.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? 'missing';
    await hub.panel.inject({
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(out.length).toBeGreaterThan(0);
    for (const secret of ['Segredo-Setup-123', 'Senha-Errada-456', token])
      expect(out).not.toContain(secret);
    const audit = JSON.stringify(hub.services.audit.query({}).items);
    for (const secret of ['Segredo-Setup-123', 'Senha-Errada-456', token])
      expect(audit).not.toContain(secret);
  });
});
