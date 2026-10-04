import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ARGON2_PARAMS,
  hashPassword,
  needsRehash,
  parsePhc,
  verifyPassword,
} from '../src/application/auth/passwords';
import { isLoopbackAddress } from '../src/application/auth/auth-service';
import { SqliteUsersRepo } from '../src/db/repositories/auth-repos';
import { SESSION_COOKIE } from '../src/http/session-auth';
import { apiHarness, type ApiHarness, TEST_PASSWORD } from './helpers/api';

const harnesses: ApiHarness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});
async function harness(...args: Parameters<typeof apiHarness>) {
  const h = await apiHarness(...args);
  harnesses.push(h);
  return h;
}

describe('password hashing (ADR-018)', () => {
  it('hashes to an argon2id PHC string and verifies', async () => {
    const phc = await hashPassword('correct horse battery');
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword('correct horse battery', phc)).toBe(true);
    expect(await verifyPassword('wrong horse battery', phc)).toBe(false);
    expect(await verifyPassword('x', 'not-a-phc')).toBe(false);
    expect(parsePhc('$argon2i$v=19$m=1,t=1,p=1$a$b')).toBeNull();
  });

  it('uses a random salt and flags hashes with outdated parameters', async () => {
    const a = await hashPassword('same password!');
    const b = await hashPassword('same password!');
    expect(a).not.toBe(b);
    expect(needsRehash(a)).toBe(false);
    const weak = await hashPassword('same password!', { ...ARGON2_PARAMS, memory: 8192 });
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });

  it('classifies loopback socket addresses', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.9.9.9'])
      expect(isLoopbackAddress(a), a).toBe(true);
    for (const a of ['10.0.0.5', '::ffff:10.0.0.5', '', null])
      expect(isLoopbackAddress(a), String(a)).toBe(false);
  });
});

describe('first run (FR-006.1)', () => {
  it('AC-006-01 setup from a non-loopback address is refused with 403', async () => {
    const h = await harness();
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      remoteAddress: '10.0.3.50',
      payload: { username: 'admin', password: TEST_PASSWORD },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ code: 'SETUP_NOT_ALLOWED' });
    expect(h.services.auth.needsSetup()).toBe(true);
    expect(h.services.audit.query({ action: 'auth.setup' }).items[0]).toMatchObject({
      result: 'denied',
    });
  });

  it('creates the first admin from loopback, then refuses a second setup', async () => {
    const h = await harness();
    expect((await h.app.inject({ url: '/api/auth/setup-status' })).json()).toEqual({
      needsSetup: true,
    });
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'Admin', password: TEST_PASSWORD },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ username: 'admin', role: 'admin' });
    expect((await h.app.inject({ url: '/api/auth/setup-status' })).json()).toEqual({
      needsSetup: false,
    });
    const again = await h.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'other', password: TEST_PASSWORD },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'SETUP_ALREADY_DONE' });
  });

  it('AC-006-02 two concurrent setups create exactly one admin', async () => {
    const h = await harness();
    const ctx = { ip: '127.0.0.1', remoteAddress: '127.0.0.1' };
    const results = await Promise.allSettled([
      h.services.auth.setup({ username: 'ana', password: TEST_PASSWORD }, ctx),
      h.services.auth.setup({ username: 'bia', password: TEST_PASSWORD }, ctx),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(new SqliteUsersRepo(h.services.db).count()).toBe(1);
  });

  it('rejects weak passwords and bad usernames at validation', async () => {
    const h = await harness();
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'a b', password: 'short' },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('login and sessions (constitution §6.2, plan §6.4)', () => {
  it('logs in with a HttpOnly SameSite=Strict cookie; me and logout work', async () => {
    const h = await harness();
    await h.createUser('ana', 'operator');
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ANA', password: TEST_PASSWORD },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ username: 'ana', role: 'operator' });
    const c = r.cookies.find((x) => x.name === SESSION_COOKIE);
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(c?.secure).toBeFalsy(); // loopback HTTP
    expect(c?.value).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    const cookie = `${SESSION_COOKIE}=${c?.value}`;

    expect((await h.inject({ url: '/api/auth/me', cookie })).json()).toMatchObject({
      username: 'ana',
    });
    // only the hash is stored
    const stored = h.services.db.all<{ id_hash: string }>('SELECT id_hash FROM sessions');
    expect(stored[0]?.id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]?.id_hash).not.toBe(c?.value);

    expect((await h.inject({ method: 'POST', url: '/api/auth/logout', cookie })).statusCode).toBe(
      204,
    );
    expect((await h.inject({ url: '/api/auth/me', cookie })).statusCode).toBe(401);
  });

  it('wrong password and unknown user both give LOGIN_INVALID; attempts are audited without secrets', async () => {
    const h = await harness();
    await h.createUser('ana', 'operator');
    for (const payload of [
      { username: 'ana', password: 'errada-errada-1' },
      { username: 'ninguem', password: 'errada-errada-1' },
    ]) {
      const r = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({ code: 'LOGIN_INVALID' });
    }
    const audit = h.services.audit.query({ action: 'auth.login' });
    expect(audit.total).toBe(2);
    expect(JSON.stringify(audit.items)).not.toContain('errada-errada-1');
    expect(new SqliteUsersRepo(h.services.db).findByUsername('ana')?.failedLogins).toBe(1);
  });

  it('disabled users cannot log in and their sessions stop working', async () => {
    const h = await harness();
    const id = await h.createUser('ana', 'operator');
    const cookie = await h.login('ana');
    h.services.db.run('UPDATE users SET enabled = 0 WHERE id = ?', [id]);
    expect((await h.inject({ url: '/api/auth/me', cookie })).statusCode).toBe(401);
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: TEST_PASSWORD },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ code: 'USER_DISABLED' });
  });

  it('expires sessions after the idle timeout (12 h default)', async () => {
    const h = await harness();
    const cookie = await h.as('operator');
    h.clock.advance(11 * 3_600_000);
    expect((await h.inject({ url: '/api/auth/me', cookie })).statusCode).toBe(200); // touches
    h.clock.advance(12 * 3_600_000 + 1);
    const r = await h.inject({ url: '/api/auth/me', cookie });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('expires sessions at the absolute timeout (7 days) even when active', async () => {
    const h = await harness();
    const cookie = await h.as('operator');
    for (let hour = 0; hour < 7 * 24 - 1; hour++) {
      h.clock.advance(3_600_000);
      expect((await h.inject({ url: '/api/auth/me', cookie })).statusCode, `hour ${hour}`).toBe(
        200,
      );
    }
    h.clock.advance(3_600_000);
    expect((await h.inject({ url: '/api/auth/me', cookie })).statusCode).toBe(401);
  });

  it('rehashes passwords stored with outdated parameters on login', async () => {
    const h = await harness();
    const users = new SqliteUsersRepo(h.services.db);
    const weak = await hashPassword(TEST_PASSWORD, { ...ARGON2_PARAMS, memory: 8192 });
    const id = users.create({
      username: 'velho',
      passwordHash: weak,
      role: 'operator',
      now: h.clock.now(),
    });
    await h.login('velho');
    expect(needsRehash(users.findById(id)?.passwordHash ?? '')).toBe(false);
  });
});

describe('route protection (constitution §6.2)', () => {
  const extra = (app: Parameters<NonNullable<Parameters<typeof apiHarness>[0]>>[0]) => {
    app.post(
      '/api/test/admin-only',
      { config: { auth: 'admin' }, schema: { body: z.object({ n: z.number() }) } },
      async () => ({ ok: true }),
    );
  };

  it('401 without a session, 403 for operators on admin routes, 200 for admins', async () => {
    const h = await harness(extra);
    const none = await h.inject({ method: 'POST', url: '/api/test/admin-only', payload: { n: 1 } });
    expect(none.statusCode).toBe(401);
    const op = await h.inject({
      method: 'POST',
      url: '/api/test/admin-only',
      payload: { n: 1 },
      cookie: await h.as('operator'),
    });
    expect(op.statusCode).toBe(403);
    expect(op.json()).toMatchObject({ code: 'FORBIDDEN' });
    const admin = await h.inject({
      method: 'POST',
      url: '/api/test/admin-only',
      payload: { n: 1 },
      cookie: await h.as('admin'),
    });
    expect(admin.statusCode).toBe(200);
  });

  it('authenticates before validating the body (no schema leak to anonymous callers)', async () => {
    const h = await harness(extra);
    const r = await h.inject({
      method: 'POST',
      url: '/api/test/admin-only',
      payload: { wrong: true },
    });
    expect(r.statusCode).toBe(401);
  });

  it('an invalid or forged cookie is rejected and cleared', async () => {
    const h = await harness();
    const r = await h.inject({ url: '/api/auth/me', cookie: `${SESSION_COOKIE}=forged-value` });
    expect(r.statusCode).toBe(401);
    expect(r.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe('');
  });
});
