import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Role } from '@uniwake/shared';
import { hashPassword } from '../../src/application/auth/passwords';
import { SqliteUsersRepo } from '../../src/db/repositories/auth-repos';
import { buildApp } from '../../src/http/app';
import { registerPanelRoutes } from '../../src/http/panel';
import { LOOPBACK_HOSTS } from '../../src/http/security';
import { SESSION_COOKIE } from '../../src/http/session-auth';
import { createServices, type ServiceOptions, type Services } from '../../src/services';
import { FakeClock } from '../fakes/fake-clock';
import { T0, testDb } from './db';
import { type FakePorts, fakePorts } from './ports';

export const TEST_PASSWORD = 'senha-de-teste-123';

export interface ApiHarness {
  app: FastifyInstance;
  services: Services;
  clock: FakeClock;
  ports: FakePorts;
  createUser(username: string, role: Role, password?: string): Promise<number>;
  login(username: string, password?: string): Promise<string>;
  /** Creates (once) and logs in a user of that role; returns the Cookie header value. */
  as(role: Role): Promise<string>;
  inject(opts: InjectOptions & { cookie?: string }): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function apiHarness(
  extraRoutes?: (app: FastifyInstance, s: Services) => void,
  opts: ServiceOptions = {},
): Promise<ApiHarness> {
  const db = testDb();
  const clock = new FakeClock(T0);
  const ports = fakePorts(clock);
  const services = createServices(db, clock, ports, opts);
  const app = await buildApp({
    kind: 'panel',
    hosts: () => new Set<string>(LOOPBACK_HOSTS),
    register: async (a) => {
      await registerPanelRoutes(a, services);
      extraRoutes?.(a, services);
    },
  });
  const users = new SqliteUsersRepo(db);
  const cookies = new Map<Role, string>();

  const h: ApiHarness = {
    app,
    services,
    clock,
    ports,
    async createUser(username, role, password = TEST_PASSWORD) {
      return users.create({
        username,
        passwordHash: await hashPassword(password),
        role,
        now: clock.now(),
      });
    },
    async login(username, password = TEST_PASSWORD) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username, password },
      });
      if (r.statusCode !== 200) throw new Error(`login failed: ${r.statusCode} ${r.body}`);
      const c = r.cookies.find((x) => x.name === SESSION_COOKIE);
      if (!c) throw new Error('no session cookie');
      return `${SESSION_COOKIE}=${c.value}`;
    },
    async as(role) {
      const existing = cookies.get(role);
      if (existing) return existing;
      const username = `${role}-user`;
      if (!users.findByUsername(username)) await h.createUser(username, role);
      const cookie = await h.login(username);
      cookies.set(role, cookie);
      return cookie;
    },
    inject({ cookie, headers, ...opts }) {
      return app.inject({ ...opts, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
    },
    async close() {
      await app.close();
      db.close();
    },
  };
  return h;
}
