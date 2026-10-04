/**
 * Request hardening (constitution §6.1, §6.2): Host allowlist against DNS rebinding, CSRF Origin
 * check for unsafe methods, and security headers.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../application/errors';

export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'] as const;

/** Lowercased host name without port; handles `[::1]:47100`. */
export function hostName(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(0, end + 1) : null;
  }
  const colon = h.lastIndexOf(':');
  return colon >= 0 ? h.slice(0, colon) : h;
}

export type HostPolicy = 'any' | (() => ReadonlySet<string>);

export function isHostAllowed(
  hostHeader: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  const name = hostName(hostHeader);
  return name !== null && allowed.has(name);
}

export type OriginCheck = { kind: 'none' } | { kind: 'invalid' } | { kind: 'host'; host: string };

/** Host name from Origin (or Referer); `invalid` for unparsable values or the "null" origin. */
export function originHost(req: FastifyRequest): OriginCheck {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const source = typeof origin === 'string' ? origin : typeof referer === 'string' ? referer : null;
  if (source === null) return { kind: 'none' };
  try {
    const host = hostName(new URL(source).host);
    return host ? { kind: 'host', host } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

export interface SecurityOptions {
  hosts: HostPolicy;
  /** Enforce Origin/Referer on unsafe methods (panel listener). */
  csrf: boolean;
}

export function registerSecurity(app: FastifyInstance, opts: SecurityOptions): void {
  app.addHook('onRequest', async (req) => {
    if (opts.hosts !== 'any') {
      const allowed = opts.hosts();
      if (!isHostAllowed(req.headers.host, allowed)) throw new AppError('HOST_NOT_ALLOWED');
      if (opts.csrf && UNSAFE.has(req.method)) {
        // Browsers always send Origin on cross-site unsafe requests; non-browser clients send
        // neither header and carry no ambient credentials worth forging.
        const o = originHost(req);
        if (o.kind === 'invalid' || (o.kind === 'host' && !allowed.has(o.host))) {
          throw new AppError('ORIGIN_NOT_ALLOWED');
        }
      }
    }
  });

  app.addHook('onSend', async (req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    if (req.url.startsWith('/api/') || req.url.startsWith('/agent/')) {
      reply.header('cache-control', 'no-store');
    }
  });
}
