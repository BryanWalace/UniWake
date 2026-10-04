/**
 * SQLite access (ADR-017, plan §5, §5.1). Single synchronous connection per process.
 * Repositories use `run`/`get`/`all` with cached prepared statements and `transaction` for
 * atomic multi-statement writes.
 */
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export type SqlParams = Record<string, SQLInputValue> | SQLInputValue[];

/** Thrown when an INSERT/UPDATE violates a UNIQUE or PRIMARY KEY constraint. */
export class UniqueConstraintError extends Error {
  constructor(
    readonly table: string,
    readonly columns: string[],
    cause: unknown,
  ) {
    super(`UNIQUE constraint failed: ${table}(${columns.join(', ')})`, { cause });
    this.name = 'UniqueConstraintError';
  }
}

/** Thrown when a FOREIGN KEY constraint fails (e.g. room_id of a missing room). */
export class ForeignKeyError extends Error {
  constructor(cause: unknown) {
    super('FOREIGN KEY constraint failed', { cause });
    this.name = 'ForeignKeyError';
  }
}

const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

function mapError(e: unknown): unknown {
  const err = e as { errcode?: number; message?: string };
  if (err.errcode === SQLITE_CONSTRAINT_UNIQUE || err.errcode === SQLITE_CONSTRAINT_PRIMARYKEY) {
    // "UNIQUE constraint failed: devices.mac" or "...: schedule_runs.schedule_id, schedule_runs.planned_at"
    const cols =
      (err.message ?? '')
        .split('failed:')[1]
        ?.split(',')
        .map((s) => s.trim()) ?? [];
    const table = cols[0]?.split('.')[0] ?? '';
    return new UniqueConstraintError(
      table,
      cols.map((c) => c.split('.')[1] ?? c),
      e,
    );
  }
  if (err.errcode === SQLITE_CONSTRAINT_FOREIGNKEY) return new ForeignKeyError(e);
  return e;
}

export interface DbOptions {
  busyTimeoutMs?: number;
}

export class Db {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private txDepth = 0;

  constructor(
    readonly path: string,
    opts: DbOptions = {},
  ) {
    this.raw = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      this.raw.exec(`PRAGMA busy_timeout = ${Math.trunc(opts.busyTimeoutMs ?? 5000)};`);
      this.raw.exec('PRAGMA journal_mode = WAL;');
      this.raw.exec('PRAGMA synchronous = FULL;');
      this.raw.exec('PRAGMA foreign_keys = ON;');
    } catch (e) {
      // M1-F2: a corrupt file fails here; close so the file is not left locked (Windows).
      this.raw.close();
      throw e;
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /** Executes a write; returns changes and last insert id. */
  run(sql: string, params: SqlParams = []): { changes: number; lastInsertRowid: number } {
    try {
      const s = this.stmt(sql);
      const r = Array.isArray(params) ? s.run(...params) : s.run(params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    } catch (e) {
      throw mapError(e);
    }
  }

  get<T>(sql: string, params: SqlParams = []): T | undefined {
    const s = this.stmt(sql);
    return (Array.isArray(params) ? s.get(...params) : s.get(params)) as T | undefined;
  }

  all<T>(sql: string, params: SqlParams = []): T[] {
    const s = this.stmt(sql);
    return (Array.isArray(params) ? s.all(...params) : s.all(params)) as T[];
  }

  /** Runs raw SQL (DDL, multiple statements). */
  exec(sql: string): void {
    try {
      this.raw.exec(sql);
    } catch (e) {
      throw mapError(e);
    }
  }

  /**
   * Runs `fn` atomically. The outermost call uses BEGIN IMMEDIATE (takes the write lock up front);
   * nested calls use savepoints, so an inner failure can be caught without aborting the outer one.
   */
  transaction<T>(fn: () => T): T {
    const depth = this.txDepth;
    const savepoint = `sp_${depth}`;
    this.raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.txDepth++;
    try {
      const result = fn();
      this.raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (e) {
      this.raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw e;
    } finally {
      this.txDepth--;
    }
  }

  pragma<T = unknown>(name: string): T | undefined {
    const row = this.raw.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
    return row ? (Object.values(row)[0] as T) : undefined;
  }

  close(): void {
    this.statements.clear();
    if (this.raw.isOpen) this.raw.close();
  }
}

/** Opens an in-memory database (tests). */
export function openMemoryDb(): Db {
  return new Db(':memory:');
}
