/**
 * Builds a Fastify instance for one listener (plan §6). The panel listener gets the Host
 * allowlist and CSRF check; the agent listener accepts any Host (targets use the hub's IP) and
 * relies on enrollment tokens.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, LogController } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandling } from './errors';
import { registerRouteAuthRegistry } from './route-auth';
import { type HostPolicy, registerSecurity } from './security';

export type ListenerKind = 'panel' | 'agent';

export interface BuildAppOptions {
  kind: ListenerKind;
  logger?: FastifyBaseLogger;
  hosts: HostPolicy;
  bodyLimit?: number;
  /**
   * Registers routes and plugins after the core hooks are installed. Route modules call
   * `app.withTypeProvider<ZodTypeProvider>()` for typed request schemas.
   */
  register: (app: FastifyInstance) => void | Promise<void>;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    ...(opts.logger ? { loggerInstance: opts.logger } : { logger: false }),
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: opts.bodyLimit ?? 1024 * 1024,
    requestTimeout: 30_000,
    trustProxy: false,
    genReqId: () => randomUUID().slice(0, 8),
    return503OnClosing: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerRouteAuthRegistry(app);
  registerErrorHandling(app);
  registerSecurity(app, { hosts: opts.hosts, csrf: opts.kind === 'panel' });

  app.addHook('onResponse', async (req, reply) => {
    req.log.debug(
      {
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'request',
    );
  });

  await opts.register(app);
  await app.ready();
  return app;
}
