import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../application/errors';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

const certificateSchema = z.object({
  /** The PFX file, base64 (at most ~150 KB). */
  pfxBase64: z.string().min(1).max(200_000),
  password: z.string().max(200),
});

/** FR-016 settings (admin only, FR-006.2). The body is validated by the shared settings schema. */
export function settingsRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { auth: 'admin' } as const;

  r.get('/api/settings', { config: admin }, async () => s.settingsAdmin.view());

  r.patch('/api/settings', { config: admin }, async (req) =>
    s.settingsAdmin.save(req.body, actorOf(req)),
  );

  // ADR-012: an admin-supplied certificate for the LAN panel (applies after a restart).
  r.post(
    '/api/settings/certificate',
    { config: admin, bodyLimit: 300_000, schema: { body: certificateSchema } },
    async (req, reply) => {
      if (!s.panelCertificates) throw new AppError('NOT_FOUND');
      try {
        s.panelCertificates.save(Buffer.from(req.body.pfxBase64, 'base64'), req.body.password);
      } catch (e) {
        throw new AppError('VALIDATION_FAILED', {}, [
          { path: 'pfxBase64', message: e instanceof Error ? e.message : 'Certificado inválido.' },
        ]);
      }
      s.audit.record({ actor: actorOf(req), action: 'settings.certificate', target: 'panel' });
      return reply.status(200).send({ restartRequired: true });
    },
  );
}
