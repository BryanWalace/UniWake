import { afterEach, describe, expect, it } from 'vitest';
import {
  coversMorning,
  type HealthDetails,
  HealthService,
} from '../src/application/health/health-service';
import { NodeProcessRunner } from '../src/adapters/process-runner';
import { parseRegDword, parseSleepOnAc, WindowsHostChecks } from '../src/adapters/windows-host';
import { SqliteSchedulerRepo } from '../src/db/repositories/scheduler-repo';
import { FakeProcessRunner, MemoryLogger } from './fakes/system-fakes';
import { FakeClock } from './fakes/fake-clock';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

const POWERCFG_EN = `Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
  Subgroup GUID: 238c9fa8-0aad-41ed-83f4-97be242c8f20  (Sleep)
    Power Setting GUID: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Sleep after)
      Minimum Possible Setting: 0x00000000
      Maximum Possible Setting: 0xffffffff
      Possible Settings increment: 0x00000001
      Possible Settings units: Seconds
    Current AC Power Setting Index: 0x00000708
    Current DC Power Setting Index: 0x00000384
`;
const POWERCFG_PT_NEVER = `GUID do Esquema de Energia: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado)
    GUID da Configuração de Energia: 29f6c1db-86da-48c5-9fdb-f2b67b1f44da  (Suspender após)
      Configuração Mínima Possível: 0x00000000
      Configuração Máxima Possível: 0xffffffff
      Incremento de Configurações Possíveis: 0x00000001
      Unidades de Configurações Possíveis: Segundos
    Índice de Configuração de Energia CA Atual: 0x00000000
    Índice de Configuração de Energia CC Atual: 0x00000384
`;
const REG_HOURS = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings
    ActiveHoursStart    REG_DWORD    0x8
    ActiveHoursEnd    REG_DWORD    0x11
`;

describe('Windows host checks (FR-012)', () => {
  it('parses powercfg and reg output by value, not by (localized) label', () => {
    expect(parseSleepOnAc(POWERCFG_EN)).toBe(true); // 1800 s on AC
    expect(parseSleepOnAc(POWERCFG_PT_NEVER)).toBe(false); // "Nunca" on AC
    expect(parseSleepOnAc('erro')).toBeNull();
    expect(parseRegDword(REG_HOURS, 'ActiveHoursStart')).toBe(8);
    expect(parseRegDword(REG_HOURS, 'ActiveHoursEnd')).toBe(17);
  });

  it('reads sleep, pending reboot and active hours through the process runner', async () => {
    const runner = new FakeProcessRunner();
    runner.on('powercfg.exe', { exitCode: 0, stdout: POWERCFG_EN, stderr: '' });
    runner.on('reg.exe', (args) =>
      args[1]!.includes('RebootRequired')
        ? { exitCode: 0, stdout: 'HKLM\\...\\RebootRequired', stderr: '' }
        : args[1]!.includes('UX\\Settings')
          ? { exitCode: 0, stdout: REG_HOURS, stderr: '' }
          : { exitCode: 1, stdout: '', stderr: 'ERROR' },
    );
    expect(await new WindowsHostChecks(runner, 'C:\\Windows').check()).toEqual({
      sleepOnAc: true,
      pendingReboot: true,
      activeHours: { start: 8, end: 17 },
    });
  });

  it('active hours must cover 05:00–08:00, also across midnight', () => {
    expect(coversMorning({ start: 5, end: 23 })).toBe(true);
    expect(coversMorning({ start: 22, end: 9 })).toBe(true);
    expect(coversMorning({ start: 8, end: 17 })).toBe(false);
    expect(coversMorning({ start: 6, end: 18 })).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')(
    'real Windows: the read-only checks run without errors',
    async () => {
      const facts = await new WindowsHostChecks(new NodeProcessRunner()).check();
      expect([true, false, null]).toContain(facts.sleepOnAc);
      expect([true, false, null]).toContain(facts.pendingReboot);
    },
    60_000,
  );
});

describe('health (FR-012)', () => {
  it('AC-012-02: without a session /api/health returns only its status; details need a session', async () => {
    const h = await apiHarness();
    hs.push(h);
    const r = await h.inject({ url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json<object>())).toEqual(['status']);
    expect((await h.inject({ url: '/api/health/details' })).statusCode).toBe(401);
  });

  it('AC-012-01: a scheduler tick older than 2 minutes → "Agendador parado" and public health degraded', async () => {
    const h = await apiHarness();
    hs.push(h);
    const repo = new SqliteSchedulerRepo(h.services.db);
    repo.setLastTick(h.clock.now());
    h.services.monitor.lastSweep = {
      startedAt: h.clock.now(),
      durationMs: 1000,
      probed: 0,
      online: 0,
      offline: 0,
      unknown: 0,
      changed: 0,
    };
    expect((await h.inject({ url: '/api/health' })).json()).toEqual({ status: 'ok' });
    h.clock.advance(2 * 60_000 + 1);
    expect((await h.inject({ url: '/api/health' })).json()).toEqual({ status: 'degraded' });
    const d = (
      await h.inject({ url: '/api/health/details', cookie: await h.as('operator') })
    ).json<HealthDetails>();
    expect(d.scheduler.stalled).toBe(true);
    const w = d.warnings.find((x) => x.code === 'scheduler_stalled')!;
    expect(w).toMatchObject({
      severity: 'error',
      message: expect.stringMatching(/^Agendador parado/),
    });
  });

  it('AC-012-03: a GitHub Date 5 minutes ahead raises the clock warning; host warnings explain what to do', async () => {
    const clock = new FakeClock(T0);
    const health = new HealthService({
      clock,
      logger: new MemoryLogger(),
      version: '1.2.3',
      startedAt: T0,
      dbOk: () => true,
      dbSizeBytes: () => 1024,
      lastBackupAt: () => null,
      schedulerLastTick: () => T0,
      schedulerPaused: () => false,
      nextRun: () => ({ scheduleName: 'Manhã', at: T0 + 3_600_000 }),
      lastSweep: () => ({ startedAt: T0, durationMs: 45_000 }),
      monitorIntervalMs: () => 60_000,
      time: { remoteNow: () => Promise.resolve(T0 + 5 * 60_000) },
      host: {
        check: () =>
          Promise.resolve({
            sleepOnAc: true,
            pendingReboot: true,
            activeHours: { start: 8, end: 17 },
          }),
      },
    });
    await health.refreshSlowChecks();
    const d = health.details();
    expect(d.clock.skewMs).toBe(5 * 60_000);
    expect(d.warnings.map((w) => w.code)).toEqual([
      'sweep_slow',
      'clock_skew',
      'sleep_on_ac',
      'pending_reboot',
      'active_hours',
    ]);
    expect(d.warnings.find((w) => w.code === 'clock_skew')!.message).toMatch(/5 min atrasado/);
    expect(d.warnings.find((w) => w.code === 'active_hours')!.message).toMatch(/8h–17h/);
    expect(d.status).toBe('ok'); // warnings, not outages
    expect(d).toMatchObject({
      version: '1.2.3',
      dbSizeBytes: 1024,
      scheduler: { nextRun: { scheduleName: 'Manhã' } },
    });
  });

  it('a database that does not answer is "down"', () => {
    const health = new HealthService({
      clock: new FakeClock(T0),
      logger: new MemoryLogger(),
      version: 'x',
      startedAt: T0,
      dbOk: () => false,
      dbSizeBytes: () => null,
      lastBackupAt: () => null,
      schedulerLastTick: () => T0,
      schedulerPaused: () => false,
      nextRun: () => null,
      lastSweep: () => null,
      monitorIntervalMs: () => 60_000,
      time: null,
      host: null,
    });
    expect(health.status()).toBe('down');
    expect(health.details().warnings[0]!.code).toBe('database');
  });
});
