import { afterEach, describe, expect, it } from 'vitest';
import type { User } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

async function setup() {
  const h = await apiHarness();
  hs.push(h);
  const admin = await h.as('admin');
  const call = async <T>(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
    cookie = admin,
  ) => {
    const r = await h.inject({ method, url, cookie, ...(payload ? { payload } : {}) });
    return { status: r.statusCode, body: (r.body ? r.json() : null) as T };
  };
  const adminId = h.services.users.list().find((u) => u.username === 'admin-user')!.id;
  return { h, admin, call, adminId };
}

describe('users API (FR-006.2)', () => {
  it('admins create, list and update users; duplicates and weak passwords are refused', async () => {
    const { call } = await setup();
    const created = await call<User>('POST', '/api/users', {
      username: 'Maria.Silva',
      password: 'mesa-do-professor-7',
      role: 'operator',
    });
    expect(created).toMatchObject({
      status: 201,
      body: { username: 'maria.silva', role: 'operator', enabled: true },
    });
    expect((created.body as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    const dup = await call<{ code: string }>('POST', '/api/users', {
      username: 'maria.silva',
      password: 'outra-senha-boa-9',
      role: 'operator',
    });
    expect(dup).toMatchObject({ status: 409, body: { code: 'USERNAME_DUPLICATE' } });
    const weak = await call<{ code: string }>('POST', '/api/users', {
      username: 'joao',
      password: 'joao123456',
      role: 'operator',
    });
    expect(weak).toMatchObject({ status: 422, body: { code: 'PASSWORD_TOO_WEAK' } });
    const list = await call<User[]>('GET', '/api/users');
    expect(list.body.map((u) => u.username)).toEqual(['admin-user', 'maria.silva']);
    const promoted = await call<User>('PATCH', `/api/users/${created.body.id}`, { role: 'admin' });
    expect(promoted.body.role).toBe('admin');
  });

  it('operators get 403 and anonymous callers 401 on every users route', async () => {
    const { h, call } = await setup();
    const operator = await h.as('operator');
    for (const [method, url, body] of [
      ['GET', '/api/users', undefined],
      ['POST', '/api/users', { username: 'x', password: 'mesa-do-professor-7', role: 'admin' }],
      ['PATCH', '/api/users/1', { role: 'admin' }],
      ['POST', '/api/users/1/reset-password', { newPassword: 'mesa-do-professor-7' }],
    ] as const) {
      expect((await call(method, url, body, operator)).status, `${method} ${url}`).toBe(403);
      expect((await h.inject({ method, url, ...(body ? { payload: body } : {}) })).statusCode).toBe(
        401,
      );
    }
  });

  it('the last enabled admin cannot be demoted or disabled', async () => {
    const { h, call, adminId } = await setup();
    for (const patch of [{ role: 'operator' }, { enabled: false }]) {
      const r = await call<{ code: string }>('PATCH', `/api/users/${adminId}`, patch);
      expect(r).toMatchObject({ status: 409, body: { code: 'LAST_ADMIN' } });
    }
    const second = await call<User>('POST', '/api/users', {
      username: 'vice',
      password: 'mesa-do-professor-7',
      role: 'admin',
    });
    expect((await call('PATCH', `/api/users/${adminId}`, { role: 'operator' })).status).toBe(200);
    // the demoted admin was logged out; the remaining admin cannot disable themselves
    const vice = await h.login('vice', 'mesa-do-professor-7');
    const self = await call<{ code: string }>(
      'PATCH',
      `/api/users/${second.body.id}`,
      { enabled: false },
      vice,
    );
    expect(self).toMatchObject({ status: 409, body: { code: 'LAST_ADMIN' } });
  });

  it('disabling a user or resetting their password ends their sessions; all of it is audited', async () => {
    const { h, call } = await setup();
    const operatorCookie = await h.as('operator');
    const opId = h.services.users.list().find((u) => u.username === 'operator-user')!.id;
    expect(
      (
        await call('POST', `/api/users/${opId}/reset-password`, {
          newPassword: 'quadro-branco-azul',
        })
      ).status,
    ).toBe(204);
    expect((await h.inject({ url: '/api/auth/me', cookie: operatorCookie })).statusCode).toBe(401);
    const again = await h.login('operator-user', 'quadro-branco-azul');
    expect((await call('PATCH', `/api/users/${opId}`, { enabled: false })).status).toBe(200);
    expect((await h.inject({ url: '/api/auth/me', cookie: again })).statusCode).toBe(401);
    const login = await h.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator-user', password: 'quadro-branco-azul' },
    });
    expect(login.json<{ code: string }>().code).toBe('USER_DISABLED');
    expect((await call('PATCH', '/api/users/999', { enabled: false })).status).toBe(404);
    const actions = h.services.db
      .all<{ action: string }>(
        "SELECT action FROM audit_log WHERE action LIKE 'user.%' ORDER BY id",
      )
      .map((r) => r.action);
    expect(actions).toEqual(['user.reset_password', 'user.update']);
  });
});
