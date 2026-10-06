import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuditService } from '../src/application/audit/audit-service';
import type { ReleaseSource } from '../src/application/ports';
import { isInside, parsePlan, type UpdatePlan } from '../src/application/update/plan';
import { PLAN_FILE, UpdateInstaller } from '../src/application/update/update-installer';
import type { StoredRelease } from '../src/application/update/update-service';
import { SqliteAuditRepo } from '../src/db/repositories/audit-repo';
import { FakeClock } from './fakes/fake-clock';
import { FakeFileSystem, MemoryLogger } from './fakes/system-fakes';
import { T0, testDb } from './helpers/db';

const DATA = join('C:', 'ProgramData', 'UniWake');
const UPDATES = join(DATA, 'updates');
const INSTALLER = 'MZ instalador do UniWake 1.1.0';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const RELEASE: StoredRelease = {
  version: '1.1.0',
  name: 'UniWake 1.1.0',
  notes: '',
  publishedAt: '2026-10-01T12:00:00Z',
  installer: { url: 'https://github.com/r/UniWake-Setup.exe', size: Buffer.byteLength(INSTALLER) },
  checksumUrl: 'https://github.com/r/UniWake-Setup.exe.sha256',
};

/** Release downloads go into the in-memory file system; failures are scripted per URL. */
class FakeDownloads implements ReleaseSource {
  bodies = new Map<string, string>([
    [RELEASE.installer!.url, INSTALLER],
    [RELEASE.checksumUrl!, `${sha(INSTALLER)}  UniWake-Setup.exe\n`],
  ]);
  failures = new Map<string, number>();
  calls: string[] = [];
  constructor(private readonly fs: FakeFileSystem) {}
  latest() {
    return Promise.resolve({ release: null, serverDate: null });
  }
  download(url: string, dest: string): Promise<void> {
    this.calls.push(url);
    const left = this.failures.get(url) ?? 0;
    if (left > 0) {
      this.failures.set(url, left - 1);
      this.fs.files.set(dest, 'partial'); // a broken transfer leaves bytes behind
      return Promise.reject(new Error('connection reset'));
    }
    this.fs.files.set(dest, this.bodies.get(url)!);
    return Promise.resolve();
  }
}

function setup(pending: StoredRelease | null = RELEASE) {
  const db = testDb();
  const clock = new FakeClock(T0);
  const fs = new FakeFileSystem();
  const source = new FakeDownloads(fs);
  const audit = new AuditService(new SqliteAuditRepo(db), clock);
  const notices: string[] = [];
  let backups = 0;
  const installer = new UpdateInstaller({
    fs,
    source,
    pending: () => pending,
    backup: () => ({ file: `uniwake-pre-update-${++backups}.db` }),
    audit,
    notice: (m) => notices.push(m),
    clock,
    logger: new MemoryLogger(),
    paths: { dataDir: DATA, installDir: join('C:', 'Program Files', 'UniWake') },
    version: '1.0.0',
    panelPort: 47100,
    schemaVersion: 3,
    dbSizeBytes: () => 1000,
    retryDelaysMs: [10, 20],
  });
  const audits = () => audit.query({ limit: 50, offset: 0 }).items;
  return { db, clock, fs, source, installer, notices, audits, backupsMade: () => backups };
}

const exe = join(UPDATES, 'UniWake-Setup-1.1.0.exe');

describe('update preparation (FR-001.3)', () => {
  it('downloads, verifies, backs up and writes a plan the updater accepts', async () => {
    const { installer, fs, audits, backupsMade } = setup();
    const plan = await installer.prepare();
    expect(fs.files.get(exe)).toBe(INSTALLER);
    expect(plan).toMatchObject({
      version: '1.1.0',
      previousVersion: '1.0.0',
      installer: exe,
      sha256: sha(INSTALLER),
      serviceName: 'UniWake',
      healthUrl: 'http://127.0.0.1:47100/api/health',
      backupFile: join(DATA, 'backups', 'uniwake-pre-update-1.db'),
      schemaVersion: 3,
      createdAt: T0,
    });
    expect(backupsMade()).toBe(1);
    const written = fs.files.get(join(UPDATES, PLAN_FILE))!;
    expect(JSON.parse(written)).toEqual(plan);
    expect(audits()[0]).toMatchObject({ action: 'update.prepared', target: 'version:1.1.0' });
  });

  it('AC-001-07: a checksum mismatch never runs the installer: file deleted, audited, shown', async () => {
    const { installer, fs, source, audits, notices, backupsMade } = setup();
    source.bodies.set(RELEASE.checksumUrl!, `${'0'.repeat(64)}  UniWake-Setup.exe\n`);
    await expect(installer.prepare()).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
    expect(fs.files.has(exe)).toBe(false);
    expect(fs.files.has(join(UPDATES, PLAN_FILE))).toBe(false);
    expect(backupsMade()).toBe(0);
    expect(audits()[0]).toMatchObject({
      action: 'update.failed',
      result: 'error',
      details: { reason: 'CHECKSUM_MISMATCH' },
    });
    expect(notices).toEqual([
      'O arquivo de atualização baixado está corrompido ou foi alterado. Nada foi instalado.',
    ]);
  });

  it('a file of the wrong size is refused like a checksum mismatch', async () => {
    const { installer, source } = setup();
    source.bodies.set(RELEASE.installer!.url, `${INSTALLER}!`);
    source.bodies.set(RELEASE.checksumUrl!, sha(`${INSTALLER}!`));
    await expect(installer.prepare()).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
  });

  it('AC-001-09: an interrupted download is discarded and retried, at most 3 attempts', async () => {
    const ok = setup();
    ok.source.failures.set(RELEASE.installer!.url, 2);
    const p = ok.installer.prepare();
    await ok.clock.advanceAsync(10);
    await ok.clock.advanceAsync(20);
    await expect(p).resolves.toMatchObject({ version: '1.1.0' });
    expect(ok.source.calls.filter((u) => u === RELEASE.installer!.url)).toHaveLength(3);

    const bad = setup();
    bad.source.failures.set(RELEASE.installer!.url, 3);
    const q = bad.installer.prepare();
    q.catch(() => undefined);
    await bad.clock.advanceAsync(10);
    await bad.clock.advanceAsync(20);
    await expect(q).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    expect(bad.fs.files.has(exe)).toBe(false); // no partial file kept
    expect(bad.audits()[0]!.details).toMatchObject({ reason: 'DOWNLOAD_FAILED' });
  });

  it('AC-001-14: below 3 × installer + database of free space, nothing is downloaded', async () => {
    const { installer, fs, source, notices } = setup();
    fs.free = 3 * RELEASE.installer!.size + 999;
    await expect(installer.prepare()).rejects.toMatchObject({ code: 'UPDATE_DISK_SPACE' });
    expect(source.calls).toEqual([]);
    expect(notices[0]).toMatch(
      /^Espaço em disco insuficiente para atualizar\. Libere pelo menos 1 MB\.$/,
    );
  });

  it('refuses when nothing is pending or another preparation is running', async () => {
    await expect(setup(null).installer.prepare()).rejects.toMatchObject({
      code: 'UPDATE_NOT_AVAILABLE',
    });
    const { installer } = setup();
    const first = installer.prepare();
    await expect(installer.prepare()).rejects.toMatchObject({ code: 'UPDATE_IN_PROGRESS' });
    await first;
  });
});

describe('plan file checks (ADR-023)', () => {
  const plan: UpdatePlan = {
    version: '1.1.0',
    previousVersion: '1.0.0',
    installDir: 'C:\\Program Files\\UniWake',
    dataDir: 'C:\\ProgramData\\UniWake',
    installer: 'C:\\ProgramData\\UniWake\\updates\\UniWake-Setup-1.1.0.exe',
    sha256: 'a'.repeat(64),
    serviceName: 'UniWake',
    healthUrl: 'http://127.0.0.1:47100/api/health',
    backupFile: 'C:\\ProgramData\\UniWake\\backups\\uniwake-pre-update.db',
    schemaVersion: 3,
    createdAt: T0,
  };

  it('accepts a plan written by the hub', () => {
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
  });

  it('refuses installers or backups outside the data dir, other services and remote health URLs', () => {
    for (const bad of [
      { installer: 'C:\\Windows\\System32\\cmd.exe' },
      { installer: 'C:\\ProgramData\\UniWake\\updates\\..\\..\\evil.exe' },
      { installer: 'C:\\ProgramData\\UniWake\\updates\\setup.bat' },
      { backupFile: 'D:\\outro.db' },
      { serviceName: 'Spooler' },
      { healthUrl: 'http://10.0.0.5:47100/api/health' },
      { sha256: 'xyz' },
      { version: '1.1' },
    ]) {
      expect(() => parsePlan(JSON.stringify({ ...plan, ...bad })), JSON.stringify(bad)).toThrow();
    }
    expect(isInside('C:\\A', 'c:\\a\\B\\c.exe')).toBe(true);
    expect(isInside('C:\\A', 'C:\\AB\\c.exe')).toBe(false);
  });
});
