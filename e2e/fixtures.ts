/**
 * E2E fixtures (M2-T13): every page is logged in as the admin and fails the test on console
 * errors, uncaught exceptions or CSP violations (constitution §5, §6.1).
 */
import AxeBuilder from '@axe-core/playwright';
import {
  type APIRequestContext,
  type Cookie,
  expect,
  type Page,
  test as base,
} from '@playwright/test';
import { SimulatedNetwork } from '../apps/server/src/adapters/simulated-network';

export const ADMIN = { username: 'admin', password: 'senha-e2e-12345' };

let sessionCookie: Cookie | null = null;

/** Chrome logs failed fetches as console errors; expected 4xx responses are not bugs. */
const IGNORED = [/Failed to load resource: the server responded with a status of 4\d\d/];

async function ensureAdmin(request: APIRequestContext) {
  const status = (await (await request.get('/api/auth/setup-status')).json()) as {
    needsSetup: boolean;
  };
  if (status.needsSetup) {
    const r = await request.post('/api/auth/setup', { data: ADMIN });
    expect(r.status(), await r.text()).toBe(201);
  }
}

export function guardConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(m.text()))) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

interface Fixtures {
  /** API client sharing cookies with the logged-in page. */
  api: APIRequestContext;
  anonymousPage: Page;
}

export const test = base.extend<Fixtures>({
  page: async ({ page, baseURL }, use) => {
    const errors = guardConsole(page);
    const context = page.context();
    // One login for the whole run: the hub allows 20 logins a minute per IP (FR-006.3).
    if (!sessionCookie) {
      await ensureAdmin(context.request);
      const login = await context.request.post('/api/auth/login', { data: ADMIN });
      expect(login.status(), await login.text()).toBe(200);
      sessionCookie = (await context.cookies()).find((c) => c.name === 'uw_session') ?? null;
    } else {
      await context.addCookies(
        [{ ...sessionCookie, url: baseURL! }].map(({ domain: _d, path: _p, ...c }) => c),
      );
    }
    await use(page);
    expect(errors, 'console errors / CSP violations').toEqual([]);
  },
  api: async ({ page }, use) => {
    await use(page.context().request);
  },
  anonymousPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = guardConsole(page);
    await ensureAdmin(context.request);
    await use(page);
    expect(errors, 'console errors / CSP violations').toEqual([]);
    await context.close();
  },
});

export { expect };

/** axe-core scan: no serious or critical violations (NFR-07). */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
  ).toEqual([]);
}

let seq = 0;
/** Unique suffix so tests sharing one database don't collide. */
export function uniq(prefix: string): string {
  seq++;
  return `${prefix}-${Date.now().toString(36)}${seq}`;
}

/** A random unicast, globally administered MAC. */
export function randomMac(): string {
  const bytes = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  bytes[0] = bytes[0]! & 0xfc;
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/** A MAC the simulated demo network wakes and answers over ICMP (no randomness in tests). */
export function wakeableMac(): string {
  for (;;) {
    const mac = randomMac();
    if (!SimulatedNetwork.neverWakes(mac) && !SimulatedNetwork.blocksIcmp(mac)) return mac;
  }
}

let octet = Math.floor(Math.random() * 10_000);
/** A fresh address in the demo subnet (10.20.0.0/16). */
export function demoIp(): string {
  const n = octet++;
  return `10.20.${200 + (Math.floor(n / 250) % 50)}.${(n % 250) + 2}`;
}
