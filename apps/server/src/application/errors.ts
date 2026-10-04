import {
  type ErrorCode,
  type ErrorParams,
  formatErrorMessage,
  httpStatusFor,
} from '@uniwake/shared';

/**
 * Typed application error (constitution §4.1). The HTTP layer turns it into
 * `{ code, message, details }` with the catalog's status and pt-BR message (ADR-006).
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly params: ErrorParams = {},
    readonly details?: unknown,
  ) {
    super(formatErrorMessage(code, params));
    this.name = 'AppError';
    this.status = httpStatusFor(code);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
