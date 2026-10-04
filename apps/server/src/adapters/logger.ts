/**
 * Structured logging (constitution §4.1, NFR-04): pino JSON lines, size-based rotation
 * (10 MB × 10 files), secrets redacted.
 */
import { mkdirSync } from 'node:fs';
import pino, { type DestinationStream, type LoggerOptions } from 'pino';
import { createStream, type Options as RfsOptions } from 'rotating-file-stream';
import type { Logger } from '../application/ports';

export const LOG_FILE = 'uniwake.log';

/** Paths never written to logs (constitution §4.1: no passwords, tokens or session ids). */
export const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'sessionId',
  'cookie',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.sessionId',
  '*.cookie',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-enrollment-token"]',
  'res.headers["set-cookie"]',
];

export function rotationOptions(dir: string): RfsOptions {
  return { path: dir, size: '10M', maxFiles: 10 };
}

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    base: { app: 'uniwake' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    formatters: { level: (label) => ({ level: label }) },
  };
}

/** Logger writing to a rotating file in `dir` (and optionally stdout for dev). */
export function createFileLogger(dir: string, level: string, alsoStdout = false): pino.Logger {
  mkdirSync(dir, { recursive: true });
  const file = createStream(LOG_FILE, rotationOptions(dir));
  const streams: { stream: DestinationStream; level: pino.Level }[] = [
    { stream: file, level: 'debug' },
  ];
  if (alsoStdout) streams.push({ stream: pino.destination(1), level: 'debug' });
  return pino(loggerOptions(level), pino.multistream(streams));
}

/** Logger writing to an arbitrary stream (tests). */
export function createStreamLogger(stream: DestinationStream, level = 'debug'): pino.Logger {
  return pino(loggerOptions(level), stream);
}

/** pino already matches the Logger port (`(obj, msg)` and `child`). */
export function asPort(logger: pino.Logger): Logger {
  return logger;
}
