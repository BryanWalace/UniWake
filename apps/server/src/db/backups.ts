/**
 * Database-level backup helpers (FR-014): online snapshots with VACUUM INTO, integrity checks of
 * backup files, the `backups` table, and the swap a requested restore performs at start-up.
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  BackupFiles,
  BackupKind,
  BackupRecord,
  BackupsRepo,
} from '../application/backups/backup-service';
import type { Db } from './connection';

const RESTORE_REQUEST = 'restore-request.json';

export class SqliteBackupsRepo implements BackupsRepo {
  constructor(private readonly db: Db) {}

  list(): BackupRecord[] {
    return this.db.all<BackupRecord>(
      'SELECT id, file, kind, created_at AS createdAt, size FROM backups ORDER BY created_at DESC, id DESC',
    );
  }

  get(id: number): BackupRecord | undefined {
    return this.db.get<BackupRecord>(
      'SELECT id, file, kind, created_at AS createdAt, size FROM backups WHERE id = ?',
      [id],
    );
  }

  insert(r: Omit<BackupRecord, 'id'>): number {
    return this.db.run('INSERT INTO backups (file, kind, created_at, size) VALUES (?, ?, ?, ?)', [
      r.file,
      r.kind,
      r.createdAt,
      r.size,
    ]).lastInsertRowid;
  }

  delete(id: number): void {
    this.db.run('DELETE FROM backups WHERE id = ?', [id]);
  }
}

/** True when SQLite says the file is a sound database. */
export function isDatabaseIntact(path: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const row = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
    return row !== undefined && Object.values(row)[0] === 'ok';
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export class DbBackupFiles implements BackupFiles {
  constructor(
    private readonly db: Db,
    private readonly dir: string,
  ) {}

  private path(file: string): string {
    if (!/^[\w.-]+$/.test(file)) throw new Error(`unsafe backup name: ${file}`);
    return join(this.dir, file);
  }

  snapshot(file: string): number {
    const target = this.path(file);
    // VACUUM INTO writes a consistent, compacted copy while the database stays in use.
    this.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    return statSync(target).size;
  }

  exists(file: string): boolean {
    return existsSync(this.path(file));
  }

  remove(file: string): void {
    rmSync(this.path(file), { force: true });
  }

  isIntact(file: string): boolean {
    return isDatabaseIntact(this.path(file));
  }

  requestRestore(req: { file: string; byId: number | null; by: string; at: number }): void {
    this.path(req.file); // validates the name
    writeFileSync(join(this.dir, RESTORE_REQUEST), JSON.stringify(req), 'utf8');
  }
}

/** Snapshot before the database is opened by services (pre-migration backup). */
export function snapshotBefore(db: Db, dir: string, kind: BackupKind, at: number): BackupRecord {
  const stamp = new Date(at)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '')
    .replace('T', '-');
  const file = `uniwake-${stamp}-${kind}.db`;
  const size = new DbBackupFiles(db, dir).snapshot(file);
  const id = new SqliteBackupsRepo(db).insert({ file, kind, createdAt: at, size });
  return { id, file, kind, createdAt: at, size };
}

/**
 * At start-up, before the database is opened: performs a requested restore (FR-014). Returns who
 * asked, so the caller can audit it in the restored database; null when there is nothing to do.
 */
export function applyPendingRestore(
  dbPath: string,
  backupsDir: string,
): { file: string; byId: number | null; by: string; at: number } | null {
  const reqPath = join(backupsDir, RESTORE_REQUEST);
  if (!existsSync(reqPath)) return null;
  const req = JSON.parse(readFileSync(reqPath, 'utf8')) as {
    file: string;
    byId: number | null;
    by: string;
    at: number;
  };
  rmSync(reqPath, { force: true }); // never retried in a loop
  const source = join(backupsDir, req.file);
  if (!/^[\w.-]+$/.test(req.file) || !isDatabaseIntact(source)) return null;
  const tmp = `${dbPath}.restore`;
  copyFileSync(source, tmp);
  for (const ext of ['-wal', '-shm']) rmSync(`${dbPath}${ext}`, { force: true });
  renameSync(tmp, dbPath);
  return req;
}
