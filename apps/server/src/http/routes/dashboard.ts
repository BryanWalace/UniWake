import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { uptimeQuerySchema } from '@uniwake/shared';
import type { HttpServices } from '../context';

/** FR-004.5 dashboard and FR-004.6 uptime (plan §6.1). */
export function dashboardRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.get('/api/dashboard', { config: auth }, async () => s.dashboard.dashboard());

  r.get('/api/uptime', { config: auth, schema: { querystring: uptimeQuerySchema } }, async (req) =>
    s.dashboard.uptime(req.query),
  );
}
