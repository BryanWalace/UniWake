import { createHash } from 'node:crypto';
import type {
  FileSystem,
  Logger,
  ProcessResult,
  ProcessRunner,
  RunOptions,
} from '../../src/application/ports';
import { FaultPlan } from './faults';

/** In-memory file system with fault injection. Paths are compared verbatim. */
export class FakeFileSystem implements FileSystem {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly faults = new FaultPlan<{ op: string; path: string }>();
  free = 10 * 1024 ** 3;

  private guard(op: string, path: string): void {
    this.faults.check({ op, path });
  }

  readText(path: string): Promise<string> {
    return this.wrap(() => {
      this.guard('read', path);
      const v = this.files.get(path);
      if (v === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
      return v;
    });
  }

  writeText(path: string, content: string): Promise<void> {
    return this.wrap(() => {
      this.guard('write', path);
      this.files.set(path, content);
    });
  }

  exists(path: string): Promise<boolean> {
    return this.wrap(() => this.files.has(path) || this.dirs.has(path));
  }

  remove(path: string): Promise<void> {
    return this.wrap(() => {
      this.guard('remove', path);
      this.files.delete(path);
    });
  }

  list(dir: string): Promise<string[]> {
    return this.wrap(() => {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...this.files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => p.slice(prefix.length));
    });
  }

  size(path: string): Promise<number> {
    return this.wrap(() => {
      const v = this.files.get(path);
      if (v === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
      return Buffer.byteLength(v);
    });
  }

  mkdirp(dir: string): Promise<void> {
    return this.wrap(() => {
      this.dirs.add(dir);
    });
  }

  freeBytes(): Promise<number> {
    return Promise.resolve(this.free);
  }

  sha256(path: string): Promise<string> {
    return this.wrap(() => {
      const v = this.files.get(path);
      if (v === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
      return createHash('sha256').update(v).digest('hex');
    });
  }

  private wrap<T>(fn: () => T): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

type Responder = (args: readonly string[], opts?: RunOptions) => ProcessResult | Error;

/** Scripted process runner: responses keyed by executable basename (case-insensitive). */
export class FakeProcessRunner implements ProcessRunner {
  readonly calls: { file: string; args: string[]; opts?: RunOptions }[] = [];
  private responders = new Map<string, Responder>();

  on(executable: string, responder: Responder | ProcessResult): this {
    this.responders.set(
      basename(executable),
      typeof responder === 'function' ? responder : () => responder,
    );
    return this;
  }

  run(file: string, args: readonly string[], opts?: RunOptions): Promise<ProcessResult> {
    this.calls.push({ file, args: [...args], ...(opts ? { opts } : {}) });
    const responder = this.responders.get(basename(file));
    if (!responder) return Promise.reject(new Error(`FakeProcessRunner: no responder for ${file}`));
    const r = responder(args, opts);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }
}

function basename(p: string): string {
  return (p.split(/[\\/]/).pop() ?? p).toLowerCase();
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  obj: object;
  msg?: string;
  bindings: Record<string, unknown>;
}

/** Captures log entries for assertions (e.g. "no secrets in logs"). */
export class MemoryLogger implements Logger {
  constructor(
    readonly entries: LogEntry[] = [],
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  debug(obj: object, msg?: string): void {
    this.push('debug', obj, msg);
  }
  info(obj: object, msg?: string): void {
    this.push('info', obj, msg);
  }
  warn(obj: object, msg?: string): void {
    this.push('warn', obj, msg);
  }
  error(obj: object, msg?: string): void {
    this.push('error', obj, msg);
  }
  child(bindings: Record<string, unknown>): Logger {
    return new MemoryLogger(this.entries, { ...this.bindings, ...bindings });
  }

  text(): string {
    return this.entries
      .map((e) => JSON.stringify({ ...e.bindings, ...e.obj, msg: e.msg }))
      .join('\n');
  }

  private push(level: LogEntry['level'], obj: object, msg?: string): void {
    this.entries.push({
      level,
      obj,
      ...(msg !== undefined ? { msg } : {}),
      bindings: this.bindings,
    });
  }
}
