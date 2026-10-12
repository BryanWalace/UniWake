import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { exportRequestSchema, importApplySchema, importPreviewSchema } from '@uniwake/shared';
import { MAX_FILE_BYTES } from '../../application/migration/document';
import { AppError } from '../../application/errors';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

const importIdSchema = z.object({ id: z.uuid() });

/** v1.4 "Backup e migração" (spec §6c, plan §16.4): admin only. */
export function migrationRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { auth: 'admin' } as const;

  // The import upload is the raw file (F11-02); this parser applies only to this content type.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES },
    (_req, body, done) => done(null, body),
  );

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

  r.post(
    '/api/migration/import',
    { config: admin, bodyLimit: MAX_FILE_BYTES },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError('IMPORT_NOT_UNIWAKE');
      return reply.status(201).send(s.importer.inspect(req.body, String(actorOf(req).id)));
    },
  );

  r.post(
    '/api/migration/import/:id/preview',
    { config: admin, schema: { params: importIdSchema, body: importPreviewSchema } },
    async (req) => s.importer.preview(req.params.id, req.body),
  );

  r.post(
    '/api/migration/import/:id/apply',
    { config: admin, schema: { params: importIdSchema, body: importApplySchema } },
    async (req) => s.importer.apply(req.params.id, req.body, actorOf(req)),
  );

  r.get('/api/migration/state', { config: admin }, async () => s.importer.state());

  r.post(
    '/api/migration/standby/activate',
    {
      config: admin,
      schema: {
        body: z.object({
          confirm: z.literal('ATIVAR', { message: 'Digite ATIVAR para confirmar.' }),
        }),
      },
    },
    async (req, reply) => {
      s.importer.activate(actorOf(req));
      return reply.status(204).send();
    },
  );

  r.post(
    '/api/migration/undo',
    {
      config: admin,
      schema: {
        body: z.object({
          confirm: z.literal('DESFAZER', { message: 'Digite DESFAZER para confirmar.' }),
        }),
      },
    },
    async (req, reply) => reply.status(202).send(s.importer.undo(actorOf(req))),
  );
}
