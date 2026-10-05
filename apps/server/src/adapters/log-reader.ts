/**
 * Log viewer source (FR-016, NFR-04): the last 5 MB of the current log file (pino JSON lines),
 * newest first, filtered by minimum level and free text. Secrets were redacted when written.
 */
import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogLine, LogSource } from '../application/ports';
import { LOG_FILE } from './logger';

export const LOG_TAIL_BYTES = 5 * 1024 * 1024;
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LEVELS)[number];

export interface LogQuery {
  level?: LogLevel;
  q?: string;
  limit?: number;
}

export class LogFileReader implements LogSource {
  constructor(private readonly dir: string) {}

  get path(): string {
    return join(this.dir, LOG_FILE);
  }

  /** The last `maxBytes` of the current file; `truncated` when older content was cut off. */
  tail(maxBytes = LOG_TAIL_BYTES): { text: string; truncated: boolean; size: number } {
    if (!existsSync(this.path)) return { text: '', truncated: false, size: 0 };
    const size = statSync(this.path).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    const fd = openSync(this.path, 'r');
    try {
      readSync(fd, buf, 0, buf.length, start);
    } finally {
      closeSync(fd);
    }
    let text = buf.toString('utf8');
    // Starting mid-file: drop the partial first line.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return { text, truncated: start > 0, size };
  }

  open(): NodeJS.ReadableStream | null {
    return existsSync(this.path) ? createReadStream(this.path) : null;
  }

  read(q: LogQuery = {}): { entries: LogLine[]; truncated: boolean; size: number } {
    const { text, truncated, size } = this.tail();
    const min = LEVELS.indexOf(q.level ?? 'debug');
    const needle = q.q?.trim().toLowerCase() ?? '';
    const limit = Math.min(q.limit ?? 500, 2000);
    const entries: LogLine[] = [];
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      const raw = lines[i]!.trim();
      if (raw === '' || (needle && !raw.toLowerCase().includes(needle))) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue; // a line cut by rotation or a crash
      }
      const level = typeof obj.level === 'string' ? obj.level : 'info';
      if (LEVELS.indexOf(level as LogLevel) < min) continue;
      const { time, level: _l, msg, module, app: _a, ...data } = obj;
      entries.push({
        time: typeof time === 'string' ? time : '',
        level,
        msg: typeof msg === 'string' ? msg : '',
        module: typeof module === 'string' ? module : null,
        data,
      });
    }
    return { entries, truncated, size };
  }
}
