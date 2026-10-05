import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EnrollRequest } from '@uniwake/shared';
import { AppError } from '../../application/errors';
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

const BEARER = /^Bearer ([A-Za-z0-9_-]{16,64})$/;

function bearerToken(req: FastifyRequest): string {
  const m = BEARER.exec(req.headers.authorization ?? '');
  if (!m) throw new AppError('ENROLL_TOKEN_INVALID');
  return m[1]!;
}

/**
 * Self-enrollment (FR-007.2, plan §7.3). The per-IP limit and the token's presence are checked in
 * `onRequest`, before the body is parsed; the body is validated after the token is known valid.
 */
export function enrollRoute(app: FastifyInstance, s: Pick<HttpServices, 'enrollment'>): void {
  app.post(
    '/agent/enroll',
    {
      config: { auth: 'enrollment' },
      onRequest: async (req) => {
        if (!s.enrollment.allowEnrollFrom(req.ip)) throw new AppError('RATE_LIMITED');
        bearerToken(req);
      },
    },
    async (req) =>
      s.enrollment.enroll(bearerToken(req), (req.body ?? {}) as EnrollRequest, { ip: req.ip }),
  );
}
