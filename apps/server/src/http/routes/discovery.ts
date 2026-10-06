import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { discoveryAddSchema, discoveryScanSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-101 network discovery (operator, like the rest of the inventory). */
export function discoveryRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const operator = { auth: 'operator' } as const;
  r.get('/api/discovery', { config: operator }, async () => s.discovery.status());
  r.post(
    '/api/discovery/scan',
    { config: operator, schema: { body: discoveryScanSchema } },
    async (req, reply) => reply.status(202).send(await s.discovery.scan(req.body, actorOf(req))),
  );
  r.post(
    '/api/discovery/add',
    { config: operator, schema: { body: discoveryAddSchema } },
    async (req) => s.discovery.add(req.body, actorOf(req)),
  );
}
