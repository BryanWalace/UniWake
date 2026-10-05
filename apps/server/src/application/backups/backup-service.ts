/**
 * Backups (FR-014, IMP-010): daily at `backup.time`, before migrations, on demand; the newest
 * `backup.retention` daily copies are kept. A restore cannot replace the open database (Windows
 * locks it), so it is requested: the backup is checked, a pre-restore backup is taken, the request
 * is audited and the service restarts; the next start swaps the file before opening it.
 */
import { localDay, nextLocalTime } from '../../domain/tz';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock, Logger, TimerHandle } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export type BackupKind = 'daily' | 'pre-migration' | 'pre-update' | 'pre-restore' | 'manual';

export interface BackupRecord {
  id: number;
  file: string;
  kind: BackupKind;
  createdAt: number;
  size: number;
}

export interface BackupsRepo {
  list(): BackupRecord[];
  get(id: number): BackupRecord | undefined;
  insert(r: Omit<BackupRecord, 'id'>): number;
  delete(id: number): void;
}

export interface BackupFiles {
  /** Writes a consistent copy of the live database to that file name. */
  snapshot(file: string): number;
  exists(file: string): boolean;
  remove(file: string): void;
  /** PRAGMA integrity_check on a backup file. */
  isIntact(file: string): boolean;
  /** Leaves the restore for the next start (see `applyPendingRestore`). */
  requestRestore(req: { file: string; byId: number | null; by: string; at: number }): void;
}

export interface BackupDeps {
  repo: BackupsRepo;
  files: BackupFiles;
  settings: SettingsService;
  clock: Clock;
  audit: AuditService;
  logger: Logger;
  /** Restarts the service (hub: exit code 75, the service manager starts it again). */
  requestRestart: () => void;
}

/** Other kinds are kept this many each (daily follows `backup.retention`). */
const KEEP_OTHER = 10;
const DAY = 86_400_000;

/** "05/10/2026" — what the operator types to confirm a restore (FR-014). */
export function backupDateLabel(at: number, tz: string): string {
  return localDay(at, tz).split('-').reverse().join('/');
}

export class BackupService {
  private timer: TimerHandle | null = null;

  constructor(private readonly d: BackupDeps) {}

  private get tz() {
    return this.d.settings.get('scheduler.timezone');
  }

  list(): (BackupRecord & { dateLabel: string })[] {
    return this.d.repo
      .list()
      .filter((b) => this.d.files.exists(b.file))
      .map((b) => ({ ...b, dateLabel: backupDateLabel(b.createdAt, this.tz) }));
  }

  create(kind: BackupKind, actor?: Actor): BackupRecord {
    const at = this.d.clock.now();
    const stamp = new Date(at)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..*$/, '')
      .replace('T', '-');
    const file = `uniwake-${stamp}-${kind}.db`;
    const size = this.d.files.snapshot(file);
    const id = this.d.repo.insert({ file, kind, createdAt: at, size });
    if (actor) {
      this.d.audit.record({
        actor,
        action: 'backup.create',
        target: `backup:${file}`,
        details: { kind, size },
      });
    }
    this.prune();
    this.d.logger.info({ file, kind, size }, 'backup created');
    return { id, file, kind, createdAt: at, size };
  }

  /** Keeps the newest `backup.retention` daily backups and KEEP_OTHER of every other kind (AC-014-01). */
  prune(): number {
    const keepDaily = this.d.settings.get('backup.retention');
    const byKind = new Map<BackupKind, BackupRecord[]>();
    for (const b of this.d.repo.list()) byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), b]);
    let removed = 0;
    for (const [kind, list] of byKind) {
      const keep = kind === 'daily' ? keepDaily : kind === 'manual' ? Infinity : KEEP_OTHER;
      const old = [...list].sort((a, b) => b.createdAt - a.createdAt).slice(keep);
      for (const b of old) {
        this.d.files.remove(b.file);
        this.d.repo.delete(b.id);
        removed++;
      }
    }
    return removed;
  }

  /** AC-014-02: check, confirm by date, pre-restore backup, audit, restart. */
  restore(id: number, confirm: string, actor: Actor): { restarting: true } {
    const b = this.d.repo.get(id);
    if (!b || !this.d.files.exists(b.file)) throw new AppError('BACKUP_NOT_FOUND');
    if (confirm.trim() !== backupDateLabel(b.createdAt, this.tz)) {
      throw new AppError('RESTORE_CONFIRMATION_MISMATCH');
    }
    if (!this.d.files.isIntact(b.file)) {
      throw new AppError('VALIDATION_FAILED', {}, [
        {
          path: 'id',
          message: 'Este backup está corrompido e não pode ser restaurado. Escolha outro.',
        },
      ]);
    }
    const safety = this.create('pre-restore');
    this.d.audit.record({
      actor,
      action: 'backup.restore_requested',
      target: `backup:${b.file}`,
      details: { backupId: id, preRestore: safety.file },
    });
    this.d.files.requestRestore({
      file: b.file,
      byId: actor.id,
      by: actor.label,
      at: this.d.clock.now(),
    });
    this.d.requestRestart();
    return { restarting: true };
  }

  /** Daily at `backup.time` local; soon after start when the last daily copy is over a day old. */
  start(): void {
    if (this.timer !== null) return;
    const now = this.d.clock.now();
    const last = Math.max(
      0,
      ...this.d.repo
        .list()
        .filter((b) => b.kind === 'daily')
        .map((b) => b.createdAt),
    );
    const nightly = nextLocalTime(now, this.d.settings.get('backup.time'), this.tz);
    this.schedule(now - last > DAY ? Math.min(nightly - now, 15 * 60_000) : nightly - now);
  }

  stop(): void {
    if (this.timer !== null) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number) {
    this.timer = this.d.clock.setTimeout(() => {
      try {
        this.create('daily');
      } catch (e) {
        this.d.logger.error({ err: e }, 'daily backup failed');
      }
      const now = this.d.clock.now();
      this.schedule(nextLocalTime(now, this.d.settings.get('backup.time'), this.tz) - now);
    }, delayMs);
  }
}
