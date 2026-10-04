import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, scheduleCreateSchema, scheduleUpdateSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-005.1 schedules (plan §6.1). */
export function scheduleRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.get('/api/schedules', { config: auth }, async () => s.schedules.list());

  r.post(
    '/api/schedules',
    { config: auth, schema: { body: scheduleCreateSchema } },
    async (req, reply) => reply.status(201).send(s.schedules.create(req.body, actorOf(req))),
  );

  r.get('/api/schedules/:id', { config: auth, schema: { params: idParamSchema } }, async (req) =>
    s.schedules.get(req.params.id),
  );

  r.patch(
    '/api/schedules/:id',
    { config: auth, schema: { params: idParamSchema, body: scheduleUpdateSchema } },
    async (req) => s.schedules.update(req.params.id, req.body, actorOf(req)),
  );

  r.delete(
    '/api/schedules/:id',
    { config: auth, schema: { params: idParamSchema } },
    async (req, reply) => {
      s.schedules.delete(req.params.id, actorOf(req));
      return reply.status(204).send();
    },
  );

  r.get(
    '/api/schedules/:id/next-runs',
    {
      config: auth,
      schema: {
        params: idParamSchema,
        querystring: z.object({ count: z.coerce.number().int().min(1).max(20).default(5) }),
      },
    },
    async (req) => s.schedules.nextRuns(req.params.id, req.query.count),
  );
}
