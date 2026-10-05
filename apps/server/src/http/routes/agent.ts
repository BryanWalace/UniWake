import type { FastifyInstance } from 'fastify';
import type { HttpServices } from '../context';

/**
 * Agent listener routes for target PCs (plan §6.2, ADR-011). The script is served as stored, so
 * its SHA-256 matches the one pinned in the panel's command (AC-007-13).
 */
export function prepareScriptRoute(
  app: FastifyInstance,
  s: Pick<HttpServices, 'enrollment'>,
): void {
  app.get('/agent/prepare-target.ps1', { config: { auth: 'public' } }, async (_req, reply) => {
    const { bytes } = s.enrollment.scriptHash();
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', 'attachment; filename="prepare-target.ps1"')
      .header('cache-control', 'no-store')
      .send(bytes);
  });
}
