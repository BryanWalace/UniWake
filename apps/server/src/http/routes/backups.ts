import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema } from '@uniwake/shared';
import { AppError } from '../../application/errors';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-014 backups (admin only). */
export function backupRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { auth: 'admin' } as const;
  const service = () => {
    if (!s.backups) throw new AppError('NOT_FOUND');
    return s.backups;
  };

  r.get('/api/backups', { config: admin }, async () => service().list());

  r.post('/api/backups', { config: admin }, async (req, reply) =>
    reply.status(201).send(service().create('manual', actorOf(req))),
  );

  r.post(
    '/api/backups/:id/restore',
    {
      config: admin,
      schema: { params: idParamSchema, body: z.object({ confirm: z.string().max(20) }) },
    },
    async (req, reply) =>
      reply.status(202).send(service().restore(req.params.id, req.body.confirm, actorOf(req))),
  );
}
