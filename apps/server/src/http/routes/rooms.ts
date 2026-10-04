import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, roomCreateSchema, roomUpdateSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-008.1 rooms (plan §6.1). */
export function roomRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.get('/api/rooms', { config: auth }, async () => s.rooms.list());

  r.post('/api/rooms', { config: auth, schema: { body: roomCreateSchema } }, async (req, reply) =>
    reply.status(201).send(s.rooms.create(req.body, actorOf(req))),
  );

  r.get('/api/rooms/:id', { config: auth, schema: { params: idParamSchema } }, async (req) =>
    s.rooms.get(req.params.id),
  );

  r.patch(
    '/api/rooms/:id',
    { config: auth, schema: { params: idParamSchema, body: roomUpdateSchema } },
    async (req) => s.rooms.update(req.params.id, req.body, actorOf(req)),
  );

  r.get(
    '/api/rooms/:id/delete-impact',
    { config: auth, schema: { params: idParamSchema } },
    async (req) => s.rooms.deleteImpact(req.params.id),
  );

  r.delete(
    '/api/rooms/:id',
    {
      config: auth,
      schema: {
        params: idParamSchema,
        querystring: z.object({ confirm: z.enum(['true', 'false']).optional() }),
      },
    },
    async (req, reply) => {
      s.rooms.delete(req.params.id, req.query.confirm === 'true', actorOf(req));
      return reply.status(204).send();
    },
  );
}
