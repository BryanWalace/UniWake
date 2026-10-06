import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-001.2/FR-001.3: status (operator); check now and install (admin, AC-001-10). */
export function updateRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/api/update', { config: { auth: 'operator' } }, async () => s.updates.status());
  r.post('/api/update/check', { config: { auth: 'admin' } }, async () => {
    await s.update.check();
    return s.updates.status();
  });
  r.post(
    '/api/update/install',
    {
      config: { auth: 'admin' },
      schema: { body: z.object({ override: z.boolean().optional() }).optional() },
    },
    async (req, reply) =>
      reply.status(202).send(await s.updates.installNow(actorOf(req), req.body?.override === true)),
  );
}
