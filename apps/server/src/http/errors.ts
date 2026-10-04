/**
 * Error mapping (ADR-006): every error leaves the API as `{ code, message, details? }` with a
 * pt-BR message. Stack traces are logged, never sent.
 */
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { type ApiError, type ErrorCode, formatErrorMessage, httpStatusFor } from '@uniwake/shared';
import { isAppError } from '../application/errors';

function body(code: ErrorCode, message?: string, details?: unknown): ApiError {
  return {
    code,
    message: message ?? formatErrorMessage(code),
    ...(details !== undefined ? { details } : {}),
  };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (isAppError(error)) {
      if (error.status >= 500) req.log.error({ err: error }, error.code);
      return reply.status(error.status).send(body(error.code, error.message, error.details));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((v) => ({
        path: v.instancePath.replace(/^\//, '').replace(/\//g, '.'),
        message: v.message,
      }));
      return reply.status(422).send(body('VALIDATION_FAILED', undefined, details));
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status === 429) return reply.status(429).send(body('RATE_LIMITED'));
    if (status === 404) return reply.status(404).send(body('NOT_FOUND'));
    if (status >= 400 && status < 500) {
      // Malformed JSON, payload too large, unsupported media type, etc.
      return reply
        .status(status === 413 ? 413 : httpStatusFor('VALIDATION_FAILED'))
        .send(body('VALIDATION_FAILED', undefined, { reason: error.code ?? 'bad_request' }));
    }
    req.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL_ERROR'));
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send(body('NOT_FOUND')));
}
