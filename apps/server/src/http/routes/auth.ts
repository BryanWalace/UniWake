import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { loginSchema, setupSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import {
  clearSessionCookie,
  currentUser,
  requestContext,
  SESSION_COOKIE,
  setSessionCookie,
} from '../session-auth';

/** FR-006.1 first run, login/logout/me (plan §6.1). */
export function authRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/auth/setup-status', { config: { auth: 'public' } }, async () => ({
    needsSetup: s.auth.needsSetup(),
  }));

  r.post(
    '/api/auth/setup',
    { config: { auth: 'public' }, schema: { body: setupSchema } },
    async (req, reply) => {
      const me = await s.auth.setup(req.body, requestContext(req));
      return reply.status(201).send(me);
    },
  );

  r.post(
    '/api/auth/login',
    { config: { auth: 'public' }, schema: { body: loginSchema } },
    async (req, reply) => {
      const { token, user } = await s.auth.login(req.body, requestContext(req));
      setSessionCookie(req, reply, token, s.settings.get('security.sessionAbsoluteDays') * 86_400);
      return user;
    },
  );

  r.post('/api/auth/logout', { config: { auth: 'operator' } }, async (req, reply) => {
    s.auth.logout(req.cookies[SESSION_COOKIE], requestContext(req));
    clearSessionCookie(req, reply);
    return reply.status(204).send();
  });

  r.get('/api/auth/me', { config: { auth: 'operator' } }, async (req) => currentUser(req));
}
