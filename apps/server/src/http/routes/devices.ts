import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  deviceCreateSchema,
  deviceListQuerySchema,
  deviceUpdateSchema,
  idParamSchema,
} from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-002.1 devices (plan §6.1). */
export function deviceRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.get(
    '/api/devices',
    { config: auth, schema: { querystring: deviceListQuerySchema } },
    async (req) => s.devices.list(req.query),
  );

  r.post(
    '/api/devices',
    { config: auth, schema: { body: deviceCreateSchema } },
    async (req, reply) => reply.status(201).send(s.devices.create(req.body, actorOf(req))),
  );

  r.get('/api/devices/:id', { config: auth, schema: { params: idParamSchema } }, async (req) =>
    s.devices.get(req.params.id),
  );

  r.patch(
    '/api/devices/:id',
    { config: auth, schema: { params: idParamSchema, body: deviceUpdateSchema } },
    async (req) => s.devices.update(req.params.id, req.body, actorOf(req)),
  );

  r.delete(
    '/api/devices/:id',
    { config: auth, schema: { params: idParamSchema } },
    async (req, reply) => {
      s.devices.delete(req.params.id, actorOf(req));
      return reply.status(204).send();
    },
  );
}
