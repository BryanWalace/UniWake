import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { idParamSchema, powerRequestSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-305 manual shutdown/restart (plan §15.4). */
export function powerRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.post(
    '/api/power/preview',
    { config: auth, schema: { body: powerRequestSchema } },
    async (req) => s.power.preview(req.body),
  );

  r.post(
    '/api/power/jobs',
    { config: auth, schema: { body: powerRequestSchema } },
    async (req, reply) => reply.status(202).send(s.power.start(req.body, actorOf(req))),
  );

  r.get('/api/power/jobs/:id', { config: auth, schema: { params: idParamSchema } }, async (req) =>
    s.power.get(req.params.id),
  );

  r.post(
    '/api/power/jobs/:id/cancel',
    { config: auth, schema: { params: idParamSchema } },
    async (req) => s.power.cancel(req.params.id, actorOf(req)),
  );
}
