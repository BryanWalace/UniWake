/**
 * Preparing an update install (FR-001.3, plan §8): enough free disk (AC-001-14), download with
 * retries that never keep a partial file (AC-001-09), size + SHA-256 check against the release's
 * checksum asset before anything runs (AC-001-07), a pre-update backup, and the plan file the
 * updater executes (ADR-023). Every failure is audited and pinned on the dashboard.
 */
import { join } from 'node:path';
import type { Actor, AuditService } from '../audit/audit-service';
import { SYSTEM_ACTOR } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock, FileSystem, Logger, ReleaseSource } from '../ports';
import type { UpdatePlan } from './plan';
import type { StoredRelease } from './update-service';

export interface UpdateInstallerDeps {
  fs: FileSystem;
  source: ReleaseSource;
  pending: () => StoredRelease | null;
  /** Pre-update backup; null when this hub keeps no backups. */
  backup: () => { file: string } | null;
  audit: AuditService;
  notice: (message: string) => void;
  clock: Clock;
  logger: Logger;
  paths: { dataDir: string; installDir: string };
  version: string;
  panelPort: number;
  schemaVersion: number;
  dbSizeBytes: () => number;
  /** Waits between download attempts (AC-001-09: at most 3 attempts per check). */
  retryDelaysMs?: readonly number[];
}

const MB = 1024 * 1024;
export const PLAN_FILE = 'update-plan.json';

export class UpdateInstaller {
  private busy = false;

  constructor(private readonly d: UpdateInstallerDeps) {}

  get updatesDir(): string {
    return join(this.d.paths.dataDir, 'updates');
  }

  private fail(code: string, version: string, actor: Actor, message: string, error?: unknown) {
    this.d.logger.warn({ err: error, code, version }, 'update failed');
    this.d.audit.record({
      actor,
      action: 'update.failed',
      target: `version:${version}`,
      result: 'error',
      details: { reason: code },
    });
    this.d.notice(message);
  }

  /** Downloads and checks the pending release, backs up and writes the plan. */
  async prepare(actor: Actor = SYSTEM_ACTOR): Promise<UpdatePlan> {
    const rel = this.d.pending();
    if (!rel?.installer || !rel.checksumUrl) throw new AppError('UPDATE_NOT_AVAILABLE');
    if (this.busy) throw new AppError('UPDATE_IN_PROGRESS');
    this.busy = true;
    try {
      return await this.prepareRelease(rel, rel.installer, rel.checksumUrl, actor);
    } finally {
      this.busy = false;
    }
  }

  private async prepareRelease(
    rel: StoredRelease,
    installer: { url: string; size: number },
    checksumUrl: string,
    actor: Actor,
  ): Promise<UpdatePlan> {
    const { fs } = this.d;
    await fs.mkdirp(this.updatesDir);
    // AC-001-14: room for the installer, the unpacked version and a database copy.
    const required = 3 * installer.size + this.d.dbSizeBytes();
    if ((await fs.freeBytes(this.updatesDir)) < required) {
      const err = new AppError('UPDATE_DISK_SPACE', { requiredMb: Math.ceil(required / MB) });
      this.fail('UPDATE_DISK_SPACE', rel.version, actor, err.message);
      throw err;
    }

    const exe = join(this.updatesDir, `UniWake-Setup-${rel.version}.exe`);
    const sumFile = `${exe}.sha256`;
    let expected: string;
    try {
      await this.downloadWithRetries(checksumUrl, sumFile);
      const m = /^\s*([0-9a-fA-F]{64})\b/.exec(await fs.readText(sumFile));
      if (!m) throw new Error('checksum file without a SHA-256');
      expected = m[1]!.toLowerCase();
      await this.downloadWithRetries(installer.url, exe);
    } catch (e) {
      const err = new AppError('DOWNLOAD_FAILED');
      this.fail('DOWNLOAD_FAILED', rel.version, actor, err.message, e);
      throw err;
    }

    // AC-001-07: never run a file that is not exactly the published one.
    const size = await fs.size(exe);
    const actual = await fs.sha256(exe);
    if (size !== installer.size || actual !== expected) {
      await fs.remove(exe);
      await fs.remove(sumFile);
      const err = new AppError('CHECKSUM_MISMATCH');
      this.fail('CHECKSUM_MISMATCH', rel.version, actor, err.message);
      throw err;
    }

    const backup = this.d.backup();
    const plan: UpdatePlan = {
      version: rel.version,
      previousVersion: this.d.version,
      installDir: this.d.paths.installDir,
      dataDir: this.d.paths.dataDir,
      installer: exe,
      sha256: expected,
      serviceName: 'UniWake',
      healthUrl: `http://127.0.0.1:${this.d.panelPort}/api/health`,
      backupFile: backup ? join(this.d.paths.dataDir, 'backups', backup.file) : null,
      schemaVersion: this.d.schemaVersion,
      createdAt: this.d.clock.now(),
    };
    await fs.writeText(join(this.updatesDir, PLAN_FILE), JSON.stringify(plan, null, 2));
    this.d.audit.record({
      actor,
      action: 'update.prepared',
      target: `version:${rel.version}`,
      details: { from: this.d.version, size, backup: backup?.file ?? null },
    });
    return plan;
  }

  /** AC-001-09: up to 3 attempts with growing waits; a failed attempt leaves no file. */
  private async downloadWithRetries(url: string, dest: string): Promise<void> {
    const delays = this.d.retryDelaysMs ?? [30_000, 120_000];
    for (let attempt = 0; ; attempt++) {
      try {
        await this.d.source.download(url, dest);
        return;
      } catch (e) {
        await this.d.fs.remove(dest);
        if (attempt >= delays.length) throw e;
        this.d.logger.warn(
          { err: e, url, attempt: attempt + 1 },
          'update download failed, retrying',
        );
        await this.d.clock.sleep(delays[attempt]!);
      }
    }
  }
}
