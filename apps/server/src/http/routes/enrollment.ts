import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  enrollmentCommandSchema,
  enrollmentTokenCreateSchema,
  idParamSchema,
} from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-007.3 "Preparar máquinas": tokens, addresses and the one-line command (operator). */
export function enrollmentRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const operator = { auth: 'operator' } as const;

  r.get('/api/enrollment/tokens', { config: operator }, async () => s.enrollment.listTokens());

  r.post(
    '/api/enrollment/tokens',
    { config: operator, schema: { body: enrollmentTokenCreateSchema } },
    async (req, reply) => reply.status(201).send(s.enrollment.createToken(req.body, actorOf(req))),
  );

  r.post(
    '/api/enrollment/tokens/:id/revoke',
    { config: operator, schema: { params: idParamSchema } },
    async (req) => s.enrollment.revokeToken(req.params.id, actorOf(req)),
  );

  r.get('/api/enrollment/addresses', { config: operator }, async () => s.enrollment.addresses());

  r.post(
    '/api/enrollment/command',
    { config: operator, schema: { body: enrollmentCommandSchema } },
    async (req) => s.enrollment.command(req.body, actorOf(req)),
  );
}
