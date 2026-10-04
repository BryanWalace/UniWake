import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/application/auth/passwords';
import { CONFIG_DEFAULTS } from '../src/config';
import { SqliteUsersRepo } from '../src/db/repositories/auth-repos';
import { createHub, type Hub } from '../src/hub';
import { SESSION_COOKIE } from '../src/http/session-auth';
import { FakeClock } from './fakes/fake-clock';
import { T0 } from './helpers/db';
import { AGENT_ALLOWED, checkRouteTable, concreteUrl } from './helpers/route-authz';

let hub: Hub;
let dir: string;
let operatorCookie: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'uniwake-authz-'));
  // Production surface includes the static panel route.
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  hub = await createHub({
    config: {
      ...CONFIG_DEFAULTS,
      panelPort: 0,
      agentPort: 0,
      agentBind: '127.0.0.1',
      dataDir: dir,
      demo: false,
    },
    logger: pino({ level: 'silent' }),
    clock: new FakeClock(T0),
    webDir: dir,
  });
  new SqliteUsersRepo(hub.db).create({
    username: 'op',
    passwordHash: await hashPassword('senha-operador-1'),
    role: 'operator',
    now: T0,
  });
  const r = await hub.panel.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'op', password: 'senha-operador-1' },
  });
  operatorCookie = `${SESSION_COOKIE}=${r.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? ''}`;
});

afterAll(async () => {
  await hub.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('route-table authorization (IMP-014, constitution §5)', () => {
  it('substitutes route params', () => {
    expect(concreteUrl('/api/rooms/:id/delete-impact')).toBe('/api/rooms/1/delete-impact');
    expect(concreteUrl('/*')).toBe('/x');
  });

  it('panel: every protected route rejects anonymous callers, admin routes reject operators', async () => {
    expect(hub.panel.routeTable.length).toBeGreaterThan(0);
    const failures = await checkRouteTable(hub.panel, { operatorCookie });
    expect(failures).toEqual([]);
  });

  it('panel: only an explicit allowlist of routes is public', () => {
    const publicRoutes = hub.panel.routeTable
      .filter((r) => r.auth === 'public')
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(publicRoutes).toEqual(
      [
        'GET /api/health',
        'GET /api/auth/setup-status',
        'POST /api/auth/setup',
        'POST /api/auth/login',
        'GET /*', // SPA static files (only when a web dir is configured)
      ].sort(),
    );
  });

  it('agent listener exposes nothing beyond health, enrollment and the script (ADR-011)', async () => {
    for (const r of hub.agent.routeTable) {
      expect(AGENT_ALLOWED.has(`${r.method} ${r.url}`), `${r.method} ${r.url}`).toBe(true);
      expect(['public', 'enrollment']).toContain(r.auth);
    }
    expect(await checkRouteTable(hub.agent, { host: '10.0.3.15:47101' })).toEqual([]);
  });
});
