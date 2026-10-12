import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { exportRequestSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** v1.4 "Backup e migração" (spec §6c, plan §16.4): admin only. */
export function migrationRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { auth: 'admin' } as const;

  r.post(
    '/api/migration/export',
    { config: admin, schema: { body: exportRequestSchema } },
    async (req, reply) => {
      const file = await s.exporter.build(req.body, actorOf(req));
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="${file.fileName}"`)
        .send(file.bytes);
    },
  );
}
