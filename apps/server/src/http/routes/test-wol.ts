import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { idParamSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-007.4 "Testar WoL desta máquina" and FR-010 diagnostics (operator). */
export function testWolRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const operator = { auth: 'operator' } as const;

  r.post(
    '/api/devices/:id/test-wol',
    { config: operator, schema: { params: idParamSchema } },
    async (req, reply) => reply.status(201).send(s.testWol.start(req.params.id, actorOf(req))),
  );

  r.get(
    '/api/devices/:id/diagnostics',
    { config: operator, schema: { params: idParamSchema } },
    async (req) => s.diagnostics.get(req.params.id),
  );

  r.get('/api/test-wol/:id', { config: operator, schema: { params: idParamSchema } }, async (req) =>
    s.testWol.get(req.params.id),
  );

  r.post(
    '/api/test-wol/:id/cancel',
    { config: operator, schema: { params: idParamSchema } },
    async (req) => s.testWol.cancel(req.params.id, actorOf(req)),
  );
}
