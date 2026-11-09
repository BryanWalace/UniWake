/**
 * v1.7.0 (FR-704.1, ADR-066): errors of the hub process are never lost — unhandled rejections are
 * logged and the hub keeps going, an uncaught exception is written synchronously before the exit,
 * and the next start says that the previous run did not stop cleanly.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { CrashGuard, installProcessGuards } from '../src/adapters/crash-guard';
import { LogFileReader } from '../src/adapters/log-reader';
import { CONFIG_DEFAULTS, dataPaths } from '../src/config';
import { createHub } from '../src/hub';
import { MemoryLogger } from './fakes/system-fakes';

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'uniwake-crash-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('crash guard (FR-704.1)', () => {
  it('AC-704-01 an uncaught exception is written synchronously as a fatal line the Logs page reads, then the process exits 1', () => {
    const dir = tempDir();
    const guard = new CrashGuard(dir);
    const proc = new EventEmitter();
    const logger = new MemoryLogger();
    const exits: number[] = [];
    installProcessGuards(proc, logger, guard, (c) => exits.push(c));
    proc.emit('uncaughtException', new Error('boom'));
    expect(exits).toEqual([1]);
    const lines = new LogFileReader(dir).read({ level: 'fatal' }).entries;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'fatal' });
    expect(JSON.stringify(lines[0]!.data)).toContain('boom');
  });

  it('AC-704-01 an unhandled promise rejection is logged with the error and the hub keeps running', () => {
    const guard = new CrashGuard(tempDir());
    const proc = new EventEmitter();
    const logger = new MemoryLogger();
    const exits: number[] = [];
    installProcessGuards(proc, logger, guard, (c) => exits.push(c));
    proc.emit('unhandledRejection', new Error('sem resposta'));
    proc.emit('warning', new Error('MaxListenersExceededWarning'));
    expect(exits).toEqual([]);
    expect(logger.entries.map((e) => [e.level, e.msg])).toEqual([
      ['error', 'unhandled promise rejection (the hub keeps running)'],
      ['warn', 'Node.js warning'],
    ]);
  });

  it('AC-704-01 a run that did not stop cleanly is reported with the last lines of the service error log', () => {
    const dir = tempDir();
    const service = join(dir, 'service');
    mkdirSync(service);
    writeFileSync(
      join(service, 'UniWake.err.log'),
      ['linha 1', 'FATAL ERROR: Reached heap limit', '  at foo (server.mjs:1:1)', ''].join('\r\n'),
    );
    const first = new CrashGuard(dir);
    expect(first.previousRun()).toBeNull();
    first.markRunning('1.7.0', 1000);
    const prev = new CrashGuard(dir).previousRun();
    expect(prev).toMatchObject({ version: '1.7.0', startedAt: 1000 });
    expect(prev!.serviceErrors).toEqual([
      'linha 1',
      'FATAL ERROR: Reached heap limit',
      '  at foo (server.mjs:1:1)',
    ]);
    first.markStopped();
    expect(new CrashGuard(dir).previousRun()).toBeNull();
  });

  it('AC-704-01 a real hub logs the unclean stop at start and clears its marker on a clean stop', async () => {
    const dir = tempDir();
    const config = {
      ...CONFIG_DEFAULTS,
      panelPort: 0,
      agentPort: 0,
      agentBind: '127.0.0.1',
      dataDir: dir,
      demo: false,
    };
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, { write: (s: string) => lines.push(s) });
    const first = await createHub({ config, logger });
    await first.start();
    await first.stop();
    const clean = await createHub({ config, logger });
    await clean.start();
    expect(lines.some((l) => l.includes('did not stop cleanly'))).toBe(false);
    // The process dies here (no stop): the marker stays behind.
    clean.crashGuard.markRunning('1.7.0', 5);
    await clean.stop();
    clean.crashGuard.markRunning('1.7.0', 5);
    const after = await createHub({ config, logger });
    await after.start();
    const warn = lines.find((l) => l.includes('did not stop cleanly'));
    expect(warn).toBeDefined();
    expect(JSON.parse(warn!)).toMatchObject({ level: 40, version: '1.7.0', startedAt: 5 });
    expect(warn).toContain(join(dataPaths(dir).logs, 'service').replace(/\\/g, '\\\\'));
    await after.stop();
  });
});
