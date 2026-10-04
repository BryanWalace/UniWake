/**
 * Session enforcement (constitution §6.2). Runs in `onRequest`, i.e. before body parsing and
 * validation, so unauthenticated callers learn nothing about request schemas.
 */
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Me } from '@uniwake/shared';
import type { Actor } from '../application/audit/audit-service';
import type { AuthService } from '../application/auth/auth-service';
import { AppError } from '../application/errors';

export const SESSION_COOKIE = 'uw_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: Me | null;
  }
}

export function requestContext(req: FastifyRequest) {
  return {
    ip: req.ip,
    remoteAddress: req.socket.remoteAddress ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/** Audit actor for the logged-in user. */
export function actorOf(req: FastifyRequest): Actor {
  const me = currentUser(req);
  return { id: me.id, label: me.username };
}

export function currentUser(req: FastifyRequest): Me {
  if (!req.user) throw new AppError('UNAUTHENTICATED');
  return req.user;
}

export function setSessionCookie(
  req: FastifyRequest,
  reply: FastifyReply,
  token: string,
  maxAgeSeconds: number,
) {
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: req.protocol === 'https',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply) {
  void reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: req.protocol === 'https',
  });
}

export async function registerSessionAuth(app: FastifyInstance, auth: AuthService): Promise<void> {
  await app.register(cookie);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    const level = req.routeOptions.config.auth;
    if (level !== 'operator' && level !== 'admin') return; // public / enrollment handled by routes
    // Requests the panel sends while its user is inactive (polling, live refetches) are not
    // activity: they must not keep an unattended session alive (R-M4-01).
    const idle = req.headers['x-uniwake-idle'] === '1';
    const me = auth.authenticate(req.cookies[SESSION_COOKIE], { touch: !idle });
    if (!me) {
      if (req.cookies[SESSION_COOKIE]) clearSessionCookie(req, reply);
      throw new AppError('UNAUTHENTICATED');
    }
    if (level === 'admin' && me.role !== 'admin') throw new AppError('FORBIDDEN');
    req.user = me;
  });
}
