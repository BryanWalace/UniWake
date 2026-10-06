/** M8 break-it pass (Debug & Problem Solver): regressions for the findings in tasks.md M8-F*. */
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@uniwake/shared';
import { TaskUpdateLauncher } from '../src/adapters/update-launcher';
import { AuditService } from '../src/application/audit/audit-service';
import { SettingsService } from '../src/application/settings/settings-service';
import { UpdateCoordinator } from '../src/application/update/update-coordinator';
import type { UpdateInstaller } from '../src/application/update/update-installer';
import type { StoredRelease, UpdateService } from '../src/application/update/update-service';
import { SqliteAuditRepo } from '../src/db/repositories/audit-repo';
import { SqliteSettingsRepo } from '../src/db/repositories/settings-repo';
import { SqliteUpdateAutoSkip } from '../src/db/repositories/update-skip-repo';
import { FakeClock } from './fakes/fake-clock';
import { FakeFileSystem, MemoryLogger } from './fakes/system-fakes';
import { testDb } from './helpers/db';

const TZ = 'America/Sao_Paulo';
const local = (h: number, m = 0) => Date.UTC(2026, 9, 6, h + 3, m);
const UPDATES = join('C:', 'ProgramData', 'UniWake', 'updates');
const PENDING: StoredRelease = {
  version: '1.1.0',
  name: '',
  notes: '',
  publishedAt: '',
  installer: { url: 'https://github.com/r/UniWake-Setup.exe', size: 10 },
  checksumUrl: 'https://github.com/r/UniWake-Setup.exe.sha256',
};

/** A hub process; a second instance over the same database is the hub after a restart. */
function hub(db = testDb(), fs = new FakeFileSystem(), at = local(3, 10)) {
  const clock = new FakeClock(at);
  const settings = new SettingsService(new SqliteSettingsRepo(db), clock);
  settings.update({ 'scheduler.timezone': TZ }, null);
  const prepare = vi.fn(() => {
    fs.files.set(join(UPDATES, 'update-plan.json'), JSON.stringify({ version: '1.1.0' }));
    fs.files.set(join(UPDATES, 'UniWake-Setup-1.1.0.exe'), 'MZ');
    fs.files.set(join(UPDATES, 'UniWake-Setup-1.1.0.exe.sha256'), 'hash');
    return Promise.resolve({});
  });
  const launch = vi.fn(() => Promise.resolve());
  const coordinator = new UpdateCoordinator({
    update: {
      pending: () => PENDING,
      status: () => ({}) as Omit<UpdateStatus, 'canInstall' | 'installing' | 'blocked'>,
    } as unknown as UpdateService,
    installer: { prepare, updatesDir: UPDATES } as unknown as UpdateInstaller,
    launcher: { launch },
    fs,
    settings,
    audit: new AuditService(new SqliteAuditRepo(db), clock),
    clock,
    logger: new MemoryLogger(),
    notice: () => undefined,
    activeJobs: () => 0,
    nextScheduledRunAt: () => null,
    autoSkip: new SqliteUpdateAutoSkip(db),
  });
  return { db, fs, clock, coordinator, prepare, launch };
}

const result = (r: object) => JSON.stringify({ at: 1, ...r });

describe('M8-F1: an updater that gave up while this hub kept running', () => {
  it('is noticed on the next tick: "installing" clears and installing can be tried again', async () => {
    const a = hub(undefined, undefined, local(10));
    await a.coordinator.installNow({ id: 1, label: 'ana' });
    expect(a.coordinator.status().installing).toBe('1.1.0');
    // The service never stopped (STOP_TIMEOUT): the same process reads the updater's result.
    a.fs.files.set(
      join(UPDATES, 'update-result.json'),
      result({ result: 'failed', version: '1.0.0', reason: 'STOP_TIMEOUT' }),
    );
    await a.coordinator.tick();
    expect(a.coordinator.status().installing).toBeNull();
    await expect(a.coordinator.installNow({ id: 1, label: 'ana' })).resolves.toBeTruthy();
  });
});

describe('M8-F2: downloaded files are removed once the outcome is recorded', () => {
  it('keeps nothing but unrelated files in updates/', async () => {
    const a = hub();
    await a.coordinator.installNow({ id: 1, label: 'ana' });
    a.fs.files.set(join(UPDATES, 'installer.log'), 'log');
    a.fs.files.set(
      join(UPDATES, 'update-result.json'),
      result({ result: 'success', version: '1.1.0' }),
    );
    await a.coordinator.recordOutcome(UPDATES);
    expect([...a.fs.files.keys()].filter((p) => p.startsWith(UPDATES))).toEqual([
      join(UPDATES, 'installer.log'),
    ]);
  });
});

describe('M8-F3: a launch that fails after the watchdog was registered', () => {
  it('removes the watchdog so it does not "restore" anything 15 minutes later', async () => {
    const deleted: string[] = [];
    const control = {
      createTask: (name: string) =>
        name === 'UniWake-Updater'
          ? Promise.reject(new Error('schtasks failed'))
          : Promise.resolve(),
      runTask: () => Promise.resolve(),
      deleteTask: (name: string) => (deleted.push(name), Promise.resolve()),
    };
    await expect(
      new TaskUpdateLauncher(control, 'node.exe', 'updater.mjs', () => 0).launch(
        join(UPDATES, 'update-plan.json'),
      ),
    ).rejects.toThrow(/schtasks failed/);
    expect(deleted).toEqual(['UniWake-Watchdog']);
  });
});

describe('M8-F4: automatic mode does not retry a version that was rolled back', () => {
  it('after the rollback restart, the same window does not install it again; a newer one is fine', async () => {
    const db = testDb();
    const fs = new FakeFileSystem();
    const first = hub(db, fs, local(3, 10));
    await first.coordinator.tick();
    expect(first.prepare).toHaveBeenCalledTimes(1);
    // The updater rolled 1.1.0 back and restarted the service: a new hub process.
    fs.files.set(
      join(UPDATES, 'update-result.json'),
      result({ result: 'rolled_back', version: '1.0.0', reason: 'HEALTH_TIMEOUT' }),
    );
    const second = hub(db, fs, local(3, 20));
    await second.coordinator.recordOutcome(UPDATES);
    await second.coordinator.tick();
    expect(second.prepare).not.toHaveBeenCalled();
    // An admin may still install it by hand.
    await expect(second.coordinator.installNow({ id: 1, label: 'ana' })).resolves.toBeTruthy();
    // A success clears the skip.
    fs.files.set(
      join(UPDATES, 'update-result.json'),
      result({ result: 'success', version: '1.1.0' }),
    );
    await second.coordinator.recordOutcome(UPDATES);
    expect(new SqliteUpdateAutoSkip(db).get()).toBeNull();
  });
});
