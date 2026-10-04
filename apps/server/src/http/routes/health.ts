import type { FastifyInstance } from 'fastify';

export type HealthStatus = 'ok' | 'degraded' | 'down';

/** Public health (FR-012, AC-012-02): only `{ status }`, no details. */
export function healthRoutes(app: FastifyInstance, status: () => HealthStatus = () => 'ok'): void {
  app.get('/api/health', { config: { auth: 'public' } }, async () => ({ status: status() }));
}
