/**
 * Serves the built web panel (plan §6.1 `GET /*`). Our own route (auth: public) instead of
 * @fastify/static's auto routes, so the route-auth registry still applies. SPA fallback to
 * index.html for client routes; unknown /api and /agent paths stay JSON 404s.
 */
import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../application/errors';

export async function registerStatic(app: FastifyInstance, webDir: string): Promise<void> {
  await app.register(fastifyStatic, { root: webDir, serve: false, wildcard: false });
  const root = normalize(webDir + sep);

  app.get('/*', { config: { auth: 'public' } }, async (req, reply) => {
    const path = decodeURIComponent(req.url.split('?')[0] ?? '/');
    if (path.startsWith('/api/') || path === '/api' || path.startsWith('/agent/')) {
      throw new AppError('NOT_FOUND');
    }
    const rel = path.replace(/^\/+/, '');
    const candidate = normalize(join(webDir, rel));
    const isFile =
      rel !== '' &&
      candidate.startsWith(root) &&
      existsSync(candidate) &&
      statSync(candidate).isFile();
    if (isFile) {
      // Vite fingerprints everything under assets/, so it can be cached for a year.
      const immutable = rel.startsWith('assets/');
      return reply.sendFile(rel, {
        cacheControl: true,
        maxAge: immutable ? 365 * 86_400_000 : 0,
        immutable,
      });
    }
    return reply
      .header('cache-control', 'no-cache')
      .sendFile('index.html', { cacheControl: false });
  });
}

/**
 * Where the built panel lives: UNIWAKE_WEB_DIR, else `web/` next to the bundled server
 * (installed layout, plan §9), else the repo's `apps/web/dist` (development). Null = API only.
 */
export function resolveWebDir(env: NodeJS.ProcessEnv, bundleDir: string): string | null {
  const candidates = [
    env.UNIWAKE_WEB_DIR,
    join(bundleDir, 'web'),
    join(bundleDir, '..', '..', 'web', 'dist'),
  ].filter((c): c is string => typeof c === 'string' && c !== '');
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? null;
}
