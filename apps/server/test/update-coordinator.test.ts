import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@uniwake/shared';
import { TaskUpdateLauncher, WATCHDOG_DELAY_MS } from '../src/adapters/update-launcher';
import { AuditService } from '../src/application/audit/audit-service';
import { SettingsService } from '../src/application/settings/settings-service';
import { outcomeMessage, UpdateCoordinator } from '../src/application/update/update-coordinator';
import type { UpdateInstaller } from '../src/application/update/update-installer';
import type { StoredRelease, UpdateService } from '../src/application/update/update-service';
import { insideWindow } from '../src/domain/tz';
import { SqliteAuditRepo } from '../src/db/repositories/audit-repo';
import { SqliteSettingsRepo } from '../src/db/repositories/settings-repo';
import { FakeClock } from './fakes/fake-clock';
import { FakeFileSystem, MemoryLogger } from './fakes/system-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';
import { testDb } from './helpers/db';

const TZ = 'America/Sao_Paulo';
/** 2026-10-06 at local São Paulo time (UTC−3). */
const local = (h: number, m = 0) => Date.UTC(2026, 9, 6, h + 3, m);
const MIN = 60_000;
const UPDATES = join('C:', 'ProgramData', 'UniWake', 'updates');

const PENDING: StoredRelease = {
  version: '1.1.0',
  name: 'UniWake 1.1.0',
  notes: '',
  publishedAt: '',
  installer: { url: 'https://github.com/r/UniWake-Setup.exe', size: 10 },
  checksumUrl: 'https://github.com/r/UniWake-Setup.exe.sha256',
};

function setup(at = local(3, 10)) {
  const db = testDb();
  const clock = new FakeClock(at);
  const settings = new SettingsService(new SqliteSettingsRepo(db), clock);
  settings.update({ 'scheduler.timezone': TZ }, null);
  const audit = new AuditService(new SqliteAuditRepo(db), clock);
  const fs = new FakeFileSystem();
  const notices: { type: string; data: Record<string, unknown> }[] = [];
  let pending: StoredRelease | null = PENDING;
  let next: number | null = null;
  let active = 0;
  const prepare = vi.fn(() => Promise.resolve({}));
  const launch = vi.fn(() => Promise.resolve());
  const coordinator = new UpdateCoordinator({
    update: {
      pending: () => pending,
      status: () =>
        ({ current: '1.0.0' }) as Omit<UpdateStatus, 'canInstall' | 'installing' | 'blocked'>,
    } as unknown as UpdateService,
    installer: { prepare, updatesDir: UPDATES } as unknown as UpdateInstaller,
    launcher: { launch },
    fs,
    settings,
    audit,
    clock,
    logger: new MemoryLogger(),
    notice: (type, data) => notices.push({ type, data }),
    activeJobs: () => active,
    nextScheduledRunAt: () => next,
  });
  return {
    coordinator,
    clock,
    settings,
    fs,
    notices,
    prepare,
    launch,
    audits: () => audit.query({ limit: 20, offset: 0 }).items,
    setPending: (p: StoredRelease | null) => (pending = p),
    setNext: (t: number | null) => (next = t),
    setActive: (n: number) => (active = n),
  };
}

describe('automatic install (FR-001.3)', () => {
  it('AC-001-11: at 03:10 with a schedule due at 04:00 the install waits; with none before 05:00 it starts', async () => {
    const t = setup(local(3, 10));
    t.setNext(local(4, 0));
    await t.coordinator.tick();
    expect(t.prepare).not.toHaveBeenCalled();
    t.setNext(local(6, 50));
    await t.coordinator.tick();
    expect(t.prepare).toHaveBeenCalledTimes(1);
    expect(t.launch).toHaveBeenCalledWith(join(UPDATES, 'update-plan.json'));
    expect(t.coordinator.status().installing).toBe('1.1.0');
  });

  it('waits outside the window, while a wake runs, in manual mode, or without a pending version', async () => {
    const outside = setup(local(2, 59));
    await outside.coordinator.tick();
    const busy = setup(local(3, 30));
    busy.setActive(1);
    await busy.coordinator.tick();
    const manual = setup(local(3, 30));
    manual.settings.update({ 'update.mode': 'manual' }, null);
    await manual.coordinator.tick();
    const none = setup(local(3, 30));
    none.setPending(null);
    await none.coordinator.tick();
    for (const t of [outside, busy, manual, none]) expect(t.prepare).not.toHaveBeenCalled();
  });

  it('tries once per window day, even after a failed attempt', async () => {
    const t = setup(local(3, 10));
    t.prepare.mockRejectedValueOnce(new Error('download failed'));
    await t.coordinator.tick();
    await t.coordinator.tick();
    expect(t.prepare).toHaveBeenCalledTimes(1);
    t.clock.set(local(3, 10) + 24 * 60 * MIN);
    await t.coordinator.tick();
    expect(t.prepare).toHaveBeenCalledTimes(2);
  });

  it('ticks every 5 minutes once started', async () => {
    const t = setup(local(2, 50));
    t.coordinator.start();
    await t.clock.advanceAsync(5 * MIN); // 02:55: outside
    expect(t.prepare).not.toHaveBeenCalled();
    await t.clock.advanceAsync(5 * MIN); // 03:00: inside
    expect(t.prepare).toHaveBeenCalledTimes(1);
    t.coordinator.stop();
  });
});

describe('"Atualizar agora" (FR-001.3)', () => {
  it('is refused while busy unless an admin overrides; the start is audited', async () => {
    const t = setup(local(10));
    t.setNext(local(10, 30));
    await expect(t.coordinator.installNow({ id: 1, label: 'ana' })).rejects.toMatchObject({
      code: 'UPDATE_BLOCKED_BY_SCHEDULE',
    });
    expect(t.coordinator.status().blocked).toBe(true);
    await expect(t.coordinator.installNow({ id: 1, label: 'ana' }, true)).resolves.toEqual({
      version: '1.1.0',
    });
    expect(t.audits()[0]).toMatchObject({
      action: 'update.start',
      actorLabel: 'ana',
      details: { override: true },
    });
    await expect(t.coordinator.installNow({ id: 1, label: 'ana' }, true)).rejects.toMatchObject({
      code: 'UPDATE_IN_PROGRESS',
    });
  });

  it('nothing pending → UPDATE_NOT_AVAILABLE; a failed preparation can be retried', async () => {
    const t = setup(local(10));
    t.setPending(null);
    await expect(t.coordinator.installNow({ id: 1, label: 'ana' })).rejects.toMatchObject({
      code: 'UPDATE_NOT_AVAILABLE',
    });
    t.setPending(PENDING);
    t.prepare.mockRejectedValueOnce(new Error('CHECKSUM_MISMATCH'));
    await expect(t.coordinator.installNow({ id: 1, label: 'ana' })).rejects.toThrow();
    expect(t.coordinator.status().installing).toBeNull();
    await expect(t.coordinator.installNow({ id: 1, label: 'ana' })).resolves.toBeTruthy();
  });
});

describe('outcome at the next start', () => {
  const file = join(UPDATES, 'update-result.json');

  it('AC-001-08: a rollback is audited and pinned as "Atualização revertida" with the reason', async () => {
    const t = setup();
    t.fs.files.set(
      file,
      JSON.stringify({ result: 'rolled_back', version: '1.0.0', reason: 'HEALTH_TIMEOUT', at: 1 }),
    );
    await t.coordinator.recordOutcome(UPDATES);
    expect(t.notices).toEqual([
      {
        type: 'update_failed',
        data: {
          message:
            'Atualização revertida: a nova versão não respondeu em 2 minutos. A versão 1.0.0 foi restaurada.',
        },
      },
    ]);
    expect(t.audits()[0]).toMatchObject({ action: 'update.failed', result: 'error' });
    expect(t.fs.files.has(file)).toBe(false);
    expect(await t.coordinator.recordOutcome(UPDATES)).toBeNull();
  });

  it('AC-001-13: an update finished by the watchdog says "Atualização interrompida — versão anterior restaurada"', () => {
    expect(
      outcomeMessage({ result: 'rolled_back', version: '1.0.0', reason: 'INTERRUPTED', at: 1 }),
    ).toBe('Atualização interrompida — versão anterior restaurada.');
    expect(outcomeMessage({ result: 'success', version: '1.1.0', at: 1 })).toBe(
      'UniWake atualizado para a versão 1.1.0.',
    );
    expect(
      outcomeMessage({ result: 'failed', version: '1.0.0', reason: 'STOP_TIMEOUT', at: 1 }),
    ).toMatch(/^Atualização não instalada: o serviço não parou a tempo/);
  });

  it('a success is audited and shown as done', async () => {
    const t = setup();
    t.fs.files.set(file, JSON.stringify({ result: 'success', version: '1.1.0', at: 1 }));
    await t.coordinator.recordOutcome(UPDATES);
    expect(t.notices[0]!.type).toBe('update_done');
    expect(t.audits()[0]).toMatchObject({ action: 'update.success', result: 'ok' });
  });
});

describe('task launcher (ADR-023)', () => {
  it('registers the watchdog 15 min out and the updater, then runs the updater', async () => {
    const calls: unknown[] = [];
    const control = {
      createTask: (name: string, spec: unknown) => (
        calls.push(['create', name, spec]),
        Promise.resolve()
      ),
      runTask: (name: string) => (calls.push(['run', name]), Promise.resolve()),
    };
    const now = Date.UTC(2026, 9, 6, 6, 0);
    const plan = join(UPDATES, 'update-plan.json');
    await new TaskUpdateLauncher(control, 'C:\\node.exe', 'C:\\updater.mjs', () => now).launch(
      plan,
    );
    expect(calls).toEqual([
      [
        'create',
        'UniWake-Watchdog',
        {
          exe: 'C:\\node.exe',
          workingDir: UPDATES,
          args: ['C:\\updater.mjs', '--watchdog', plan],
          at: new Date(now + WATCHDOG_DELAY_MS),
        },
      ],
      [
        'create',
        'UniWake-Updater',
        {
          exe: 'C:\\node.exe',
          workingDir: UPDATES,
          args: ['C:\\updater.mjs', plan],
          at: new Date(now + 60_000),
        },
      ],
      ['run', 'UniWake-Updater'],
    ]);
  });
});

describe('maintenance window', () => {
  it('is [start, end) in local time and may cross midnight', () => {
    expect(insideWindow(local(3, 0), TZ, '03:00', '05:00')).toBe(true);
    expect(insideWindow(local(4, 59), TZ, '03:00', '05:00')).toBe(true);
    expect(insideWindow(local(5, 0), TZ, '03:00', '05:00')).toBe(false);
    expect(insideWindow(local(23, 30), TZ, '22:00', '02:00')).toBe(true);
    expect(insideWindow(local(1, 0), TZ, '22:00', '02:00')).toBe(true);
    expect(insideWindow(local(12, 0), TZ, '22:00', '02:00')).toBe(false);
  });
});

describe('update routes (AC-001-10)', () => {
  const hs: ApiHarness[] = [];
  afterEach(async () => {
    for (const h of hs.splice(0)) await h.close();
  });

  it('operators cannot install (403); without an installed hub there is nothing to install', async () => {
    const h = await apiHarness();
    hs.push(h);
    const op = await h.as('operator');
    const admin = await h.as('admin');
    expect(
      (await h.inject({ method: 'POST', url: '/api/update/install', cookie: op, payload: {} }))
        .statusCode,
    ).toBe(403);
    const r = await h.inject({
      method: 'POST',
      url: '/api/update/install',
      cookie: admin,
      payload: {},
    });
    expect(r.json()).toMatchObject({ code: 'UPDATE_NOT_AVAILABLE' });
    expect((await h.inject({ url: '/api/update', cookie: op })).json<UpdateStatus>()).toMatchObject(
      {
        canInstall: false,
        installing: null,
      },
    );
  });
});
