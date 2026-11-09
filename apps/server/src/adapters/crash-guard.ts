/**
 * v1.7.0 (FR-704.1, ADR-066): errors that used to vanish. An unhandled promise rejection is logged
 * with its stack and the hub keeps running; an uncaught exception is written synchronously to the
 * log (the pino stream is asynchronous and would lose it) before the process exits for the service
 * manager to restart it. A marker file tells the next start that the previous run did not stop
 * cleanly (crash, power cut, killed); that start logs it with the last lines the service wrapper
 * captured from stderr.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../application/ports';
import { LOG_FILE } from './logger';

export const RUNNING_MARKER = 'running.json';
const TAIL_BYTES = 8 * 1024;
const TAIL_LINES = 20;

export interface PreviousRun {
  startedAt: number | null;
  version: string | null;
  pid: number | null;
  /** The last lines of the service wrapper's stderr log (Node's own crash output lands there). */
  serviceErrors: string[];
}

function tail(path: string): string[] {
  try {
    const size = statSync(path).size;
    const text = readFileSync(path, 'utf8');
    const part = size > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text;
    return part
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l !== '')
      .slice(-TAIL_LINES)
      .map((l) => l.slice(0, 400));
  } catch {
    return [];
  }
}

/** The newest `*.err.log` of WinSW in `serviceDir`, or none. */
function newestErrLog(serviceDir: string): string | null {
  try {
    const files = readdirSync(serviceDir)
      .filter((f) => f.toLowerCase().endsWith('.err.log'))
      .map((f) => ({ f, at: statSync(join(serviceDir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    return files[0] ? join(serviceDir, files[0].f) : null;
  } catch {
    return null;
  }
}

export class CrashGuard {
  constructor(
    private readonly logsDir: string,
    private readonly serviceDir: string = join(logsDir, 'service'),
  ) {}

  private get marker() {
    return join(this.logsDir, RUNNING_MARKER);
  }

  /** The run that left its marker behind, or null when the last stop was clean. */
  previousRun(): PreviousRun | null {
    if (!existsSync(this.marker)) return null;
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(readFileSync(this.marker, 'utf8')) as Record<string, unknown>;
    } catch {
      // an unreadable marker still means an unclean stop
    }
    const err = newestErrLog(this.serviceDir);
    return {
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
      version: typeof raw.version === 'string' ? raw.version : null,
      pid: typeof raw.pid === 'number' ? raw.pid : null,
      serviceErrors: err ? tail(err) : [],
    };
  }

  markRunning(version: string, at: number): void {
    try {
      mkdirSync(this.logsDir, { recursive: true });
      writeFileSync(this.marker, JSON.stringify({ pid: process.pid, version, startedAt: at }));
    } catch {
      // diagnostics only
    }
  }

  markStopped(): void {
    rmSync(this.marker, { force: true });
  }

  /** One pino-shaped line written synchronously (the process is about to exit). */
  writeFatal(err: unknown, msg: string): void {
    const e = err instanceof Error ? err : new Error(String(err));
    const line = JSON.stringify({
      level: 'fatal',
      time: new Date().toISOString(),
      app: 'uniwake',
      msg,
      err: { type: e.name, message: e.message, stack: e.stack ?? null },
    });
    try {
      mkdirSync(this.logsDir, { recursive: true });
      appendFileSync(join(this.logsDir, LOG_FILE), `${line}\n`);
    } catch {
      process.stderr.write(`${line}\n`);
    }
  }
}

/** What `installProcessGuards` needs of `process` (tests pass an EventEmitter). */
export interface ProcessLike {
  on(event: 'unhandledRejection', fn: (reason: unknown) => void): unknown;
  on(event: 'uncaughtException', fn: (err: Error) => void): unknown;
  on(event: 'warning', fn: (w: Error) => void): unknown;
}

export function installProcessGuards(
  proc: ProcessLike,
  logger: Logger,
  guard: CrashGuard,
  exit: (code: number) => void,
): void {
  proc.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection (the hub keeps running)');
  });
  proc.on('uncaughtException', (err) => {
    guard.writeFatal(err, 'uncaught exception: the service stops and restarts');
    exit(1);
  });
  proc.on('warning', (w) => {
    logger.warn({ err: w }, 'Node.js warning');
  });
}
