import type { FastifyInstance } from 'fastify';
import type { HealthStatus } from '../../application/health/health-service';
import type { HttpServices } from '../context';

export type { HealthStatus };

/** Public health (FR-012, AC-012-02): only `{ status }`, no details. */
export function healthRoutes(app: FastifyInstance, status: () => HealthStatus = () => 'ok'): void {
  app.get('/api/health', { config: { auth: 'public' } }, async () => ({ status: status() }));
}

/** FR-012 health page data (operators may see it, per the FR-006.2 matrix). */
export function healthDetailRoutes(app: FastifyInstance, s: HttpServices): void {
  app.get('/api/health/details', { config: { auth: 'operator' } }, async (req) => {
    if ((req.query as { refresh?: string }).refresh === '1') await s.health.refreshSlowChecks();
    return s.health.details();
  });
}
