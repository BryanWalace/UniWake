import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '../src/config';
import { createHub, type Hub } from '../src/hub';
import { resolveWebDir } from '../src/http/static';
import { SECURITY_HEADERS } from '../src/http/security';

let hub: Hub;
let dataDir: string;
let webDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'uniwake-static-'));
  webDir = mkdtempSync(join(tmpdir(), 'uniwake-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(
    join(webDir, 'index.html'),
    '<!doctype html><title>UniWake</title><div id="root"></div>',
  );
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(webDir, 'favicon.svg'), '<svg/>');
  hub = await createHub({
    config: { ...CONFIG_DEFAULTS, dataDir, demo: false, panelPort: 0, agentPort: 0 },
    logger: pino({ level: 'silent' }),
    webDir,
  });
});
afterAll(async () => {
  await hub.stop();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(webDir, { recursive: true, force: true });
});

const get = (url: string) => hub.panel.inject({ url });

describe('web panel static files (plan §6.1)', () => {
  it('serves index.html at / and for client routes (SPA fallback) without caching', async () => {
    for (const url of ['/', '/salas/3', '/dispositivos?q=x', '/primeiro-acesso']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['content-type'], url).toMatch(/text\/html/);
      expect(r.body).toContain('<div id="root">');
      expect(r.headers['cache-control']).toBe('no-cache');
      expect(r.headers['content-security-policy']).toBe(
        SECURITY_HEADERS['content-security-policy'],
      );
    }
  });

  it('serves hashed assets with long immutable caching and other files without', async () => {
    const js = await get('/assets/index-abc123.js');
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const icon = await get('/favicon.svg');
    expect(icon.headers['content-type']).toMatch(/svg/);
    expect(icon.headers['cache-control']).toBe('public, max-age=0');
  });

  it('keeps JSON 404s for unknown API and agent paths', async () => {
    for (const url of ['/api/nope', '/api', '/agent/nope']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(404);
      expect(r.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('does not escape the web directory', async () => {
    for (const url of [
      '/../../package.json',
      '/%2e%2e/%2e%2e/package.json',
      '/assets/..%2f..%2fpackage.json',
    ]) {
      const r = await get(url);
      expect(r.body, url).not.toContain('"name"');
    }
  });

  it('registers the static route as public', () => {
    expect(hub.panel.routeTable).toContainEqual({ method: 'GET', url: '/*', auth: 'public' });
  });
});

describe('resolveWebDir', () => {
  it('prefers UNIWAKE_WEB_DIR, then web/ next to the bundle; null when nothing is built', () => {
    expect(resolveWebDir({ UNIWAKE_WEB_DIR: webDir }, '/nowhere')).toBe(webDir);
    expect(resolveWebDir({}, join(webDir, '..', 'missing'))).toBeNull();
  });
});
