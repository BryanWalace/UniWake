/**
 * Builds a Fastify instance for one listener (plan §6). The panel listener gets the Host
 * allowlist and CSRF check; the agent listener accepts any Host (targets use the hub's IP) and
 * relies on enrollment tokens.
 */
import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  LogController,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { formatErrorMessage } from '@uniwake/shared';
import { registerErrorHandling } from './errors';
import { registerRouteAuthRegistry } from './route-auth';
import { type HostPolicy, registerSecurity } from './security';

export type ListenerKind = 'panel' | 'agent';

export interface BuildAppOptions {
  kind: ListenerKind;
  logger?: FastifyBaseLogger;
  hosts: HostPolicy;
  bodyLimit?: number;
  /** TLS (LAN panel, ADR-012): the listener speaks HTTPS only. */
  https?: { pfx: Buffer; passphrase: string };
  /**
   * Registers routes and plugins after the core hooks are installed. Route modules call
   * `app.withTypeProvider<ZodTypeProvider>()` for typed request schemas.
   */
  register: (app: FastifyInstance) => void | Promise<void>;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    ...(opts.https ? { https: { pfx: opts.https.pfx, passphrase: opts.https.passphrase } } : {}),
    ...(opts.logger ? { loggerInstance: opts.logger } : { logger: false }),
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: opts.bodyLimit ?? 1024 * 1024,
    requestTimeout: 30_000,
    trustProxy: false,
    genReqId: () => randomUUID().slice(0, 8),
    return503OnClosing: true,
    // R-M2-01: errors raised before routing (malformed URL, bad content type) keep ADR-006 shape.
    frameworkErrors: (error, _req, rawReply) => {
      const reply = rawReply as unknown as FastifyReply;
      void reply.status(400).send({
        code: 'VALIDATION_FAILED',
        message: formatErrorMessage('VALIDATION_FAILED'),
        details: { reason: error.code },
      });
    },
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
