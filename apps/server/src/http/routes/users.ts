import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  idParamSchema,
  passwordResetSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-006.2 users (admin only). */
export function userRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { auth: 'admin' } as const;

  r.get('/api/users', { config: admin }, async () => s.users.list());

  r.post('/api/users', { config: admin, schema: { body: userCreateSchema } }, async (req, reply) =>
    reply.status(201).send(await s.users.create(req.body, actorOf(req))),
  );

  r.patch(
    '/api/users/:id',
    { config: admin, schema: { params: idParamSchema, body: userUpdateSchema } },
    async (req) => s.users.update(req.params.id, req.body, actorOf(req)),
  );

  r.post(
    '/api/users/:id/reset-password',
    { config: admin, schema: { params: idParamSchema, body: passwordResetSchema } },
    async (req, reply) => {
      await s.users.resetPassword(req.params.id, req.body.newPassword, actorOf(req));
      return reply.status(204).send();
    },
  );
}
