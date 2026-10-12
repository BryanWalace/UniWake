import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { enrollAgentRequestSchema, type EnrollRequest } from '@uniwake/shared';
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
export function enrollRoute(
  app: FastifyInstance,
  s: Pick<HttpServices, 'enrollment' | 'agent' | 'hubKey'>,
): void {
  app.post(
    '/agent/enroll',
    {
      config: { auth: 'enrollment' },
      onRequest: async (req) => {
        if (!s.enrollment.allowEnrollFrom(req.ip)) throw new AppError('RATE_LIMITED');
        bearerToken(req);
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as EnrollRequest & { agent?: unknown };
      const result = s.enrollment.enroll(bearerToken(req), body, { ip: req.ip });
      if (body.agent === undefined) return result; // scripts before v1.3
      // FR-301.1: a v1.3 script also gets its agent token, signed over its nonce (ADR-044).
      const asked = enrollAgentRequestSchema.safeParse(body.agent);
      if (!asked.success) {
        return { ...result, agentUnavailable: new AppError('AGENT_PROTOCOL_UNSUPPORTED').message };
      }
      let extra: object;
      try {
        extra = { agent: await s.agent.enrollAnswer(result.deviceId) };
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        extra = { agentUnavailable: e.message };
      }
      return sendSigned(reply, s.hubKey, asked.data.nonce, { ...result, ...extra });
    },
  );
}

/** JSON body plus the hub's signature over the nonce and these exact bytes (ADR-044). */
export async function sendSigned(
  reply: FastifyReply,
  hubKey: Pick<HttpServices, 'hubKey'>['hubKey'],
  nonce: string,
  payload: object,
): Promise<FastifyReply> {
  await hubKey.ensure();
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return reply
    .header('content-type', 'application/json; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-uniwake-key', hubKey.keyId())
    .header('x-uniwake-signature', hubKey.sign(nonce, bytes))
    .send(bytes);
}
