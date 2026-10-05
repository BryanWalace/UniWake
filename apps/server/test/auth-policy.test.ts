import { afterEach, describe, expect, it } from 'vitest';
import { loginBackoffMs } from '../src/application/auth/auth-service';
import { isWeakPassword } from '../src/domain/password-policy';
import { apiHarness, type ApiHarness, TEST_PASSWORD } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

describe('password policy (FR-006.3)', () => {
  it('rejects common, repeated, sequential and name-based passwords', () => {
    for (const weak of [
      '1234567890',
      'Senha123456',
      'qwertyuiop',
      'aaaaaaaaaaaa',
      'abababababab',
      'abcdefghijk',
      '0987654321',
      'Uniwake2026!',
      'Laboratório1',
      'joaosilva2026',
    ]) {
      expect(isWeakPassword(weak, 'joaosilva'), weak).toBe(true);
    }
    for (const ok of [
      'cavalo-bateria-grampo',
      'Lab3 abre às 6h50!',
      'joaosilva-gosta-de-cafe',
      'senha-de-teste-123',
    ]) {
      expect(isWeakPassword(ok, 'joaosilva'), ok).toBe(false);
    }
  });

  it('first-run setup refuses a weak admin password', async () => {
    const h = await apiHarness();
    hs.push(h);
    const r = await h.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'admin', password: 'senha123456' },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json<{ code: string }>().code).toBe('PASSWORD_TOO_WEAK');
  });
});

describe('login limits (FR-006.3)', () => {
  it('backoff: 30 s after the 5th failure, doubling, capped at 15 min; old failures stop counting', () => {
    const t = 1_000_000;
    expect(loginBackoffMs(4, t, t)).toBe(0);
    expect(loginBackoffMs(5, t, t)).toBe(30_000);
    expect(loginBackoffMs(6, t, t + 10_000)).toBe(50_000);
    expect(loginBackoffMs(20, t, t)).toBe(15 * 60_000);
    expect(loginBackoffMs(9, t, t + 16 * 60_000)).toBe(0);
  });

  it('AC-006-04: after 5 failures in 15 min the next attempt is delayed and audited', async () => {
    const h = await apiHarness();
    hs.push(h);
    await h.createUser('ana', 'operator');
    const login = (password: string) =>
      h.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ana', password } });
    for (let i = 0; i < 5; i++) {
      expect((await login('errada-123456')).statusCode).toBe(401);
      h.clock.advance(1_000);
    }
    const throttled = await login(TEST_PASSWORD); // even the right password waits
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json<{ code: string; message: string }>()).toMatchObject({
      code: 'LOGIN_THROTTLED',
      message: expect.stringContaining('Aguarde 29 segundos'), // 30 s after the 5th failure, 1 s ago
    });
    const audit = h.services.db.get<{ details: string }>(
      "SELECT details FROM audit_log WHERE action = 'auth.login' AND details LIKE '%throttled%'",
    );
    expect(JSON.parse(audit!.details)).toMatchObject({ reason: 'throttled' });
    h.clock.advance(30_000);
    expect((await login(TEST_PASSWORD)).statusCode).toBe(200);
  });

  it('a failure 16 minutes after the previous ones starts a new count', async () => {
    const h = await apiHarness();
    hs.push(h);
    await h.createUser('bia', 'operator');
    const login = (password: string) =>
      h.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bia', password } });
    for (let i = 0; i < 4; i++) await login('errada-123456');
    h.clock.advance(16 * 60_000);
    await login('errada-123456'); // 1st of a new window, not the 5th
    expect((await login(TEST_PASSWORD)).statusCode).toBe(200);
  });

  it('AC-006-04: the 21st attempt in a minute from one IP gets 429', async () => {
    const h = await apiHarness();
    hs.push(h);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) {
      const r = await h.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: `ninguem${i}`, password: 'qualquer-coisa-1' },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes[20]).toBe(429);
    h.clock.advance(60_000);
    const later = await h.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ninguem', password: 'qualquer-coisa-1' },
    });
    expect(later.statusCode).toBe(401);
  });
});

describe('password change (FR-006.3)', () => {
  it('AC-006-07: changing the password revokes every other session of that user', async () => {
    const h = await apiHarness();
    hs.push(h);
    await h.createUser('caio', 'operator');
    const here = await h.login('caio');
    const elsewhere = await h.login('caio');
    const change = (cookie: string, payload: object) =>
      h.inject({ method: 'POST', url: '/api/auth/password', cookie, payload });

    const wrong = await change(here, {
      currentPassword: 'nao-e-essa-1',
      newPassword: 'cafe-com-leite-quente',
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json<{ details: unknown }>().details).toEqual([
      { path: 'currentPassword', message: 'Senha atual incorreta.' },
    ]);
    const weak = await change(here, { currentPassword: TEST_PASSWORD, newPassword: '1234567890' });
    expect(weak.json<{ code: string }>().code).toBe('PASSWORD_TOO_WEAK');
    const same = await change(here, { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
    expect(same.statusCode).toBe(422);

    expect(
      (await change(here, { currentPassword: TEST_PASSWORD, newPassword: 'cafe-com-leite-quente' }))
        .statusCode,
    ).toBe(204);
    expect((await h.inject({ url: '/api/auth/me', cookie: here })).statusCode).toBe(200);
    expect((await h.inject({ url: '/api/auth/me', cookie: elsewhere })).statusCode).toBe(401);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'caio', password: 'cafe-com-leite-quente' },
        })
      ).statusCode,
    ).toBe(200);
    const audit = h.services.db.get<{ details: string }>(
      "SELECT details FROM audit_log WHERE action = 'auth.password_change'",
    );
    expect(JSON.parse(audit!.details)).toEqual({ revokedSessions: 1 });
  });
});
