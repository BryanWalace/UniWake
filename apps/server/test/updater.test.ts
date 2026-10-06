import { describe, expect, it } from 'vitest';
import type { UpdatePlan } from '../src/application/update/plan';
import { main } from '../src/updater/main';
import {
  paths,
  repointXml,
  TASK_WATCHDOG,
  Updater,
  type UpdaterPorts,
  xmlVersion,
} from '../src/updater/updater';

const PLAN: UpdatePlan = {
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
  createdAt: 0,
};
const F = paths(PLAN);
const xmlFor = (v: string) =>
  `<service><executable>%BASE%\\versions\\${v}\\node.exe</executable><arguments>"%BASE%\\versions\\${v}\\server.mjs"</arguments><workingdirectory>%BASE%\\versions\\${v}</workingdirectory></service>`;

/**
 * A fake Windows: the service, the installer's effect (new XML, migrated schema), the hub's
 * health per version, files, and a clock that sleeping advances.
 */
class FakeMachine implements UpdaterPorts {
  service = 'running';
  files = new Map<string, string>([
    [F.xml, xmlFor('1.0.0')],
    [PLAN.backupFile!, 'backup-bytes'],
  ]);
  schema = 3;
  db = 'live-db';
  time = 0;
  /** Versions that answer health when running. */
  healthyVersions = new Set(['1.0.0', '1.1.0']);
  stopNeverCompletes = false;
  installer: 'ok' | 'fails' | 'hangs' = 'ok';
  /** The installer migrates the schema when the new version first starts. */
  migratesTo = 4;
  calls: string[] = [];
  logs: string[] = [];
  deletedTasks: string[] = [];

  serviceState() {
    return Promise.resolve(this.service);
  }
  stopService() {
    this.calls.push('stop');
    if (!this.stopNeverCompletes) this.service = 'stopped';
    else this.service = 'stop_pending';
    return Promise.resolve();
  }
  startService() {
    this.calls.push('start');
    this.service = 'running';
    if (xmlVersion(this.files.get(F.xml)!) === '1.1.0') this.schema = this.migratesTo;
    return Promise.resolve();
  }
  deleteTask(name: string) {
    this.deletedTasks.push(name);
    return Promise.resolve();
  }
  runInstaller(file: string, args: string[]) {
    this.calls.push(`install ${file} ${args.join(' ')}`);
    if (this.installer === 'hangs') return Promise.reject(new Error('timed out after 600000 ms'));
    if (this.installer === 'fails') return Promise.resolve(1);
    this.files.set(F.xml, xmlFor('1.1.0'));
    return Promise.resolve(0);
  }
  health() {
    const v = xmlVersion(this.files.get(F.xml) ?? '');
    return Promise.resolve(
      this.service === 'running' && v && this.healthyVersions.has(v) ? 'ok' : null,
    );
  }
  readText(p: string) {
    const v = this.files.get(p);
    return v === undefined ? Promise.reject(new Error(`ENOENT ${p}`)) : Promise.resolve(v);
  }
  writeText(p: string, c: string) {
    this.files.set(p, c);
    return Promise.resolve();
  }
  exists(p: string) {
    return Promise.resolve(this.files.has(p));
  }
  restoreDatabase(backup: string) {
    this.calls.push('restore-db');
    this.db = this.files.get(backup)!;
    this.schema = PLAN.schemaVersion;
    return Promise.resolve();
  }
  schemaVersion() {
    return Promise.resolve(this.schema);
  }
  now() {
    return this.time;
  }
  sleep(ms: number) {
    this.time += ms;
    return Promise.resolve();
  }
  log(msg: string) {
    this.logs.push(msg);
  }
  result() {
    return JSON.parse(this.files.get(F.result) ?? 'null') as Record<string, unknown> | null;
  }
}

describe('updater (FR-001.3, ADR-023)', () => {
  it('stops, installs silently, starts and confirms the new version is healthy', async () => {
    const m = new FakeMachine();
    const outcome = await new Updater(PLAN, m).run();
    expect(outcome).toMatchObject({ result: 'success', version: '1.1.0' });
    expect(m.calls).toEqual([
      'stop',
      `install ${PLAN.installer} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /LOG=C:\\ProgramData\\UniWake\\updates\\installer.log`,
      'start',
    ]);
    expect(m.result()).toMatchObject({ result: 'success', version: '1.1.0' });
    expect(m.deletedTasks).toContain(TASK_WATCHDOG);
    expect(JSON.parse(m.files.get(F.state)!)).toMatchObject({ step: 'done' });
  });

  it('AC-001-08: a new version that is not healthy within 120 s is rolled back with its database', async () => {
    const m = new FakeMachine();
    m.healthyVersions.delete('1.1.0');
    const outcome = await new Updater(PLAN, m).run();
    expect(outcome).toMatchObject({
      result: 'rolled_back',
      reason: 'HEALTH_TIMEOUT',
      version: '1.0.0',
    });
    expect(m.files.get(F.xml)).toBe(xmlFor('1.0.0')); // executable, arguments and working dir
    expect(m.calls).toContain('restore-db'); // 1.1.0 had migrated the schema to 4
    expect(m.db).toBe('backup-bytes');
    expect(m.service).toBe('running');
    expect(m.time).toBeGreaterThanOrEqual(120_000);
    expect(m.result()).toMatchObject({ result: 'rolled_back', reason: 'HEALTH_TIMEOUT' });
  });

  it('keeps the database when the failed version did not migrate it', async () => {
    const m = new FakeMachine();
    m.healthyVersions.delete('1.1.0');
    m.migratesTo = 3;
    await new Updater(PLAN, m).run();
    expect(m.calls).not.toContain('restore-db');
    expect(m.db).toBe('live-db');
  });

  it('fault: the installer fails or hangs → previous version running, nothing to repoint', async () => {
    for (const mode of ['fails', 'hangs'] as const) {
      const m = new FakeMachine();
      m.installer = mode;
      const outcome = await new Updater(PLAN, m).run();
      expect(outcome, mode).toMatchObject({ result: 'rolled_back', reason: 'INSTALLER_FAILED' });
      expect(xmlVersion(m.files.get(F.xml)!)).toBe('1.0.0');
      expect(m.service).toBe('running');
      expect(m.calls).not.toContain('restore-db');
    }
  });

  it('fault: the service does not stop within 60 s → nothing installed, the old version keeps running', async () => {
    const m = new FakeMachine();
    m.stopNeverCompletes = true;
    const outcome = await new Updater(PLAN, m).run();
    expect(outcome).toMatchObject({ result: 'failed', reason: 'STOP_TIMEOUT', version: '1.0.0' });
    expect(m.calls.some((c) => c.startsWith('install'))).toBe(false);
    expect(m.calls.at(-1)).toBe('start');
    expect(m.time).toBeGreaterThanOrEqual(60_000);
  });

  it('fault: the installer starts a different version than planned → rolled back', async () => {
    const m = new FakeMachine();
    m.runInstaller = () => {
      m.files.set(F.xml, xmlFor('1.0.9'));
      return Promise.resolve(0);
    };
    const outcome = await new Updater(PLAN, m).run();
    expect(outcome).toMatchObject({ result: 'rolled_back', reason: 'WRONG_VERSION' });
    expect(xmlVersion(m.files.get(F.xml)!)).toBe('1.0.0');
  });
});

describe('watchdog (IMP-027)', () => {
  it('AC-001-13: after the updater stopped the service and crashed, the previous version comes back', async () => {
    const m = new FakeMachine();
    m.service = 'stopped';
    m.files.set(F.xml, xmlFor('1.1.0')); // crashed mid-install
    const outcome = await new Updater(PLAN, m).watchdog();
    expect(outcome).toMatchObject({
      result: 'rolled_back',
      reason: 'INTERRUPTED',
      version: '1.0.0',
    });
    expect(m.service).toBe('running');
    expect(xmlVersion(m.files.get(F.xml)!)).toBe('1.0.0');
    expect(m.result()).toMatchObject({ reason: 'INTERRUPTED' });
  });

  it('does nothing after a finished update, and records a success the updater could not write', async () => {
    const done = new FakeMachine();
    done.files.set(F.result, JSON.stringify({ result: 'success' }));
    expect(await new Updater(PLAN, done).watchdog()).toBeNull();
    expect(done.calls).toEqual([]);
    expect(done.deletedTasks).toEqual([TASK_WATCHDOG]);

    const silent = new FakeMachine();
    silent.files.set(F.xml, xmlFor('1.1.0'));
    expect(await new Updater(PLAN, silent).watchdog()).toMatchObject({
      result: 'success',
      version: '1.1.0',
    });
    expect(silent.calls).toEqual([]);
  });
});

describe('service XML helpers', () => {
  it('reads and repoints the version directory', () => {
    const xml = xmlFor('1.1.0');
    expect(xmlVersion(xml)).toBe('1.1.0');
    const back = repointXml(xml, '1.1.0', '1.0.0');
    expect(back).toBe(xmlFor('1.0.0'));
    expect(xmlVersion('<service/>')).toBeNull();
  });

  it('the entry refuses anything but a plan inside an updates folder', async () => {
    const err = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      expect(await main([])).toBe(64);
      expect(await main(['C:\\Windows\\evil.json'])).toBe(64);
    } finally {
      process.stderr.write = err;
    }
  });
});
