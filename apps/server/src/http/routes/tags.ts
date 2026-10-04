import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, tagCreateSchema, tagUpdateSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-008.2 tags (plan §6.1). */
export function tagRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.get('/api/tags', { config: auth }, async () => s.tags.list());

  r.post('/api/tags', { config: auth, schema: { body: tagCreateSchema } }, async (req, reply) =>
    reply.status(201).send(s.tags.create(req.body, actorOf(req))),
  );

  r.patch(
    '/api/tags/:id',
    { config: auth, schema: { params: idParamSchema, body: tagUpdateSchema } },
    async (req) => s.tags.update(req.params.id, req.body, actorOf(req)),
  );

  r.get(
    '/api/tags/:id/delete-impact',
    { config: auth, schema: { params: idParamSchema } },
    async (req) => s.tags.deleteImpact(req.params.id),
  );

  r.delete(
    '/api/tags/:id',
    {
      config: auth,
      schema: {
        params: idParamSchema,
        querystring: z.object({ confirm: z.enum(['true', 'false']).optional() }),
      },
    },
    async (req, reply) => {
      s.tags.delete(req.params.id, req.query.confirm === 'true', actorOf(req));
      return reply.status(204).send();
    },
  );
}
