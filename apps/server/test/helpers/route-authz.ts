/**
 * Route-table authorization checks (IMP-014, constitution §5). Reusable: each milestone's
 * routes are covered automatically because the table comes from the real registration.
 */
import type { FastifyInstance } from 'fastify';
import type { RouteEntry } from '../../src/http/route-auth';

/** Concrete URL for a route pattern: `:id` → `1`, `*` → `x`. */
export function concreteUrl(pattern: string): string {
  return pattern.replace(/:[A-Za-z0-9_]+/g, '1').replace(/\*/g, 'x');
}

export interface AuthzFailure {
  route: RouteEntry;
  check: string;
  status: number;
}

/** Agent listener routes allowed by ADR-011. */
export const AGENT_ALLOWED = new Set([
  'GET /api/health',
  'POST /agent/enroll',
  'GET /agent/prepare-target.ps1',
]);

export async function checkRouteTable(
  app: FastifyInstance,
  opts: { operatorCookie?: string; host?: string } = {},
): Promise<AuthzFailure[]> {
  const failures: AuthzFailure[] = [];
  const host = opts.host ?? '127.0.0.1:47100';
  for (const route of app.routeTable) {
    const base = {
      method: route.method as 'GET',
      url: concreteUrl(route.url),
      headers: { host },
      ...(route.method === 'GET' || route.method === 'DELETE' ? {} : { payload: {} }),
    };
    if (route.auth === 'operator' || route.auth === 'admin' || route.auth === 'enrollment') {
      const r = await app.inject(base);
      if (r.statusCode !== 401)
        failures.push({ route, check: 'anonymous → 401', status: r.statusCode });
    }
    if (route.auth === 'admin' && opts.operatorCookie) {
      const r = await app.inject({
        ...base,
        headers: { ...base.headers, cookie: opts.operatorCookie },
      });
      if (r.statusCode !== 403)
        failures.push({ route, check: 'operator → 403', status: r.statusCode });
    }
  }
  return failures;
}
