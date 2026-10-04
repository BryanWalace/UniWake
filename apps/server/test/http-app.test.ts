import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../src/application/errors';
import { buildApp } from '../src/http/app';
import { MissingRouteAuthError } from '../src/http/route-auth';
import { healthRoutes } from '../src/http/routes/health';
import { hostName, LOOPBACK_HOSTS, SECURITY_HEADERS } from '../src/http/security';

const panelHosts = () => new Set<string>([...LOOPBACK_HOSTS, 'uniwake.faculdade.local']);
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

async function panel(extra?: (app: FastifyInstance) => void) {
  const app = await buildApp({
    kind: 'panel',
    hosts: panelHosts,
    register: (a) => {
      healthRoutes(a);
      extra?.(a);
    },
  });
  apps.push(app);
  return app;
}

describe('route auth registry (constitution §6.2)', () => {
  it('fails at startup when a route does not declare auth', async () => {
    await expect(
      buildApp({
        kind: 'panel',
        hosts: panelHosts,
        register: (a) => {
          a.get('/api/oops', async () => ({}));
        },
      }),
    ).rejects.toThrow(MissingRouteAuthError);
  });

  it('records every route with its auth level (HEAD routes excluded)', async () => {
    const app = await panel((a) => {
      a.post('/api/x', { config: { auth: 'admin' } }, async () => ({}));
    });
    expect(app.routeTable).toEqual([
      { method: 'GET', url: '/api/health', auth: 'public' },
      { method: 'POST', url: '/api/x', auth: 'admin' },
    ]);
  });
});

describe('Host allowlist (constitution §6.1, DNS rebinding)', () => {
  it('parses host names with ports and IPv6 brackets', () => {
    expect(hostName('LocalHost:47100')).toBe('localhost');
    expect(hostName('[::1]:47100')).toBe('[::1]');
    expect(hostName('10.0.0.5')).toBe('10.0.0.5');
    expect(hostName(undefined)).toBeNull();
  });

  it('accepts loopback and configured names, rejects others with 421 HOST_NOT_ALLOWED', async () => {
    const app = await panel();
    for (const host of [
      '127.0.0.1:47100',
      'localhost:47100',
      '[::1]:47100',
      'uniwake.faculdade.local',
    ]) {
      const r = await app.inject({ url: '/api/health', headers: { host } });
      expect(r.statusCode, host).toBe(200);
    }
    const bad = await app.inject({ url: '/api/health', headers: { host: 'evil.example:47100' } });
    expect(bad.statusCode).toBe(421);
    expect(bad.json()).toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });

  it('agent listener accepts any host (targets use the hub IP)', async () => {
    const app = await buildApp({ kind: 'agent', hosts: 'any', register: (a) => healthRoutes(a) });
    apps.push(app);
    const r = await app.inject({ url: '/api/health', headers: { host: '10.0.3.15:47101' } });
    expect(r.statusCode).toBe(200);
  });
});

describe('CSRF Origin check (constitution §6.2)', () => {
  const route = (a: FastifyInstance) =>
    a.post('/api/thing', { config: { auth: 'public' } }, async () => ({ ok: true }));

  it('allows same-origin and header-less requests; rejects foreign or null origins', async () => {
    const app = await panel(route);
    const post = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/thing',
        headers: { host: '127.0.0.1:47100', ...headers },
      });
    expect((await post({ origin: 'http://127.0.0.1:47100' })).statusCode).toBe(200);
    expect((await post({ referer: 'http://localhost:47100/salas/1' })).statusCode).toBe(200);
    expect((await post({})).statusCode).toBe(200);
    const foreign: Record<string, string>[] = [
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { referer: 'http://evil.example/x' },
    ];
    for (const headers of foreign) {
      const r = await post(headers);
      expect(r.statusCode, JSON.stringify(headers)).toBe(403);
      expect(r.json()).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
    }
  });

  it('does not apply to GET', async () => {
    const app = await panel();
    const r = await app.inject({ url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(r.statusCode).toBe(200);
  });
});

describe('security headers and errors (ADR-006)', () => {
  it('sends CSP and hardening headers, no-store on API', async () => {
    const app = await panel();
    const r = await app.inject({ url: '/api/health' });
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers[k]).toBe(v);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual({ status: 'ok' });
  });

  it('maps AppError, Zod validation, not found, bad JSON and unexpected errors', async () => {
    const app = await panel((a) => {
      a.get('/api/app-error', { config: { auth: 'public' } }, async () => {
        throw new AppError('DEVICE_MAC_DUPLICATE', {
          mac: 'AA:BB:CC:DD:EE:FF',
          deviceName: 'PC-01',
        });
      });
      a.post(
        '/api/validate',
        { config: { auth: 'public' }, schema: { body: z.object({ name: z.string().min(1) }) } },
        async () => ({}),
      );
      a.get('/api/crash', { config: { auth: 'public' } }, async () => {
        throw new Error('secret internal detail');
      });
    });

    const dup = await app.inject({ url: '/api/app-error' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({
      code: 'DEVICE_MAC_DUPLICATE',
      message: 'O MAC AA:BB:CC:DD:EE:FF já está cadastrado no dispositivo "PC-01".',
    });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/validate',
      payload: { name: '' },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'name' }],
    });

    const badJson = await app.inject({
      method: 'POST',
      url: '/api/validate',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(badJson.statusCode).toBe(422);
    expect(badJson.json()).toMatchObject({ code: 'VALIDATION_FAILED' });

    const missing = await app.inject({ url: '/api/nothing-here' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'NOT_FOUND' });

    const crash = await app.inject({ url: '/api/crash' });
    expect(crash.statusCode).toBe(500);
    expect(crash.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(crash.body).not.toContain('secret internal detail');
  });

  it('rejects oversized bodies', async () => {
    const app = await buildApp({
      kind: 'agent',
      hosts: 'any',
      bodyLimit: 8 * 1024,
      register: (a) => {
        a.post('/agent/enroll', { config: { auth: 'enrollment' } }, async () => ({}));
      },
    });
    apps.push(app);
    const r = await app.inject({
      method: 'POST',
      url: '/agent/enroll',
      payload: { x: 'a'.repeat(9000) },
    });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
