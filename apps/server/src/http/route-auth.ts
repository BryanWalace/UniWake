/**
 * Route auth declarations (constitution §6.2, IMP-014). Every route must declare
 * `config: { auth }`; registering a route without it throws, so the server fails at startup
 * instead of exposing an unprotected endpoint.
 */
import type { FastifyInstance } from 'fastify';

export const AUTH_LEVELS = ['public', 'operator', 'admin', 'enrollment'] as const;
export type AuthLevel = (typeof AUTH_LEVELS)[number];

export interface RouteEntry {
  method: string;
  url: string;
  auth: AuthLevel;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthLevel;
    /** Skip the loopback-only rule (used only by first-run setup, which enforces its own). */
    loopbackOnly?: boolean;
  }
  interface FastifyInstance {
    routeTable: RouteEntry[];
  }
}

export class MissingRouteAuthError extends Error {
  constructor(method: string, url: string) {
    super(`Route ${method} ${url} does not declare config.auth (constitution §6.2)`);
    this.name = 'MissingRouteAuthError';
  }
}

export function registerRouteAuthRegistry(app: FastifyInstance): void {
  app.decorate('routeTable', [] as RouteEntry[]);
  app.addHook('onRoute', (route) => {
    const auth = route.config?.auth;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (auth === undefined || !AUTH_LEVELS.includes(auth)) {
      throw new MissingRouteAuthError(methods.join(','), route.url);
    }
    for (const method of methods) {
      if (method === 'HEAD') continue; // auto-generated from GET routes
      app.routeTable.push({ method, url: route.url, auth });
    }
  });
}
