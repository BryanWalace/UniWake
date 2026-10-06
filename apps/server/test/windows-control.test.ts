import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  localIso,
  parseScState,
  quoteArg,
  taskXml,
  WindowsControl,
} from '../src/adapters/windows-control';
import { FakeProcessRunner } from './fakes/system-fakes';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });

function control() {
  const dir = mkdtempSync(join(tmpdir(), 'uniwake-wc-'));
  dirs.push(dir);
  const runner = new FakeProcessRunner();
  return { runner, dir, wc: new WindowsControl(runner, dir, 'C:\\Windows') };
}

// Captured from pt-BR Windows 11: labels are translated, state names are not.
const SC_PT = `
NOME_DO_SERVIÇO: UniWake
        TIPO               : 10  WIN32_OWN_PROCESS
        ESTADO             : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
`;
const SC_EN = `
SERVICE_NAME: UniWake
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 1  STOPPED
`;

describe('service control (M8-T04, ADR-021)', () => {
  it('reads the state from the numeric code, in Portuguese or English Windows', () => {
    expect(parseScState(SC_PT, 0)).toBe('running');
    expect(parseScState(SC_EN, 0)).toBe('stopped');
    expect(parseScState('[SC] OpenService FALHA 1060', 1060)).toBe('missing');
    expect(parseScState('garbage', 0)).toBe('unknown');
  });

  it('runs sc.exe from System32 with argument arrays; "already" answers are not errors', async () => {
    const { runner, wc } = control();
    runner.on('sc.exe', (args) =>
      args[0] === 'query'
        ? ok(SC_EN)
        : { exitCode: args[0] === 'stop' ? 1062 : 1056, stdout: '', stderr: '' },
    );
    expect(await wc.serviceState('UniWake')).toBe('stopped');
    await wc.stopService('UniWake');
    await wc.startService('UniWake');
    expect(runner.calls.map((c) => [c.file, ...c.args])).toEqual([
      ['C:\\Windows\\System32\\sc.exe', 'query', 'UniWake'],
      ['C:\\Windows\\System32\\sc.exe', 'stop', 'UniWake'],
      ['C:\\Windows\\System32\\sc.exe', 'start', 'UniWake'],
    ]);
    runner.on('sc.exe', { exitCode: 5, stdout: '', stderr: 'access denied' });
    await expect(wc.startService('UniWake')).rejects.toThrow(/failed \(5\)/);
  });
});

describe('scheduled tasks (M8-T04, ADR-023)', () => {
  const spec = {
    exe: 'C:\\Program Files\\UniWake\\versions\\1.2.3\\node.exe',
    args: [
      'C:\\Program Files\\UniWake\\versions\\1.2.3\\updater.mjs',
      'C:\\ProgramData\\UniWake\\updates\\update-plan.json',
    ],
    workingDir: 'C:\\ProgramData\\UniWake\\updates',
    at: new Date(2026, 9, 6, 3, 15, 0),
  };

  it('writes a UTF-16 task XML that runs as SYSTEM at a local ISO time, and registers it', async () => {
    const { runner, wc, dir } = control();
    runner.on('schtasks.exe', ok());
    await wc.createTask('UniWake-Updater', spec, 'Atualização do UniWake');
    const file = join(dir, 'UniWake-Updater.xml');
    const raw = readFileSync(file);
    expect([raw[0], raw[1]]).toEqual([0xff, 0xfe]); // UTF-16LE byte order mark
    const xml = raw.toString('utf16le');
    expect(xml).toContain('<UserId>S-1-5-18</UserId>');
    expect(xml).toContain('<StartBoundary>2026-10-06T03:15:00</StartBoundary>');
    expect(xml).toContain(
      '<Command>&quot;C:\\Program Files\\UniWake\\versions\\1.2.3\\node.exe&quot;</Command>',
    );
    expect(xml).toContain(
      '<Arguments>&quot;C:\\Program Files\\UniWake\\versions\\1.2.3\\updater.mjs&quot; C:\\ProgramData\\UniWake\\updates\\update-plan.json</Arguments>',
    );
    expect(runner.calls[0]).toMatchObject({
      file: 'C:\\Windows\\System32\\schtasks.exe',
      args: ['/Create', '/TN', 'UniWake-Updater', '/XML', file, '/F'],
    });
  });

  it('runs and deletes tasks; deleting a missing task is fine', async () => {
    const { runner, wc } = control();
    runner.on('schtasks.exe', (args) =>
      args[0] === '/Delete' ? { exitCode: 1, stdout: '', stderr: 'not found' } : ok(),
    );
    await wc.runTask('UniWake-Updater');
    await wc.deleteTask('UniWake-Watchdog');
    expect(runner.calls.map((c) => c.args)).toEqual([
      ['/Run', '/TN', 'UniWake-Updater'],
      ['/Delete', '/TN', 'UniWake-Watchdog', '/F'],
    ]);
  });

  it('refuses task names and arguments that could change the command line', async () => {
    const { runner, wc } = control();
    runner.on('schtasks.exe', ok());
    await expect(wc.createTask('UniWake-X & calc', spec, 'x')).rejects.toThrow(/task name/);
    expect(() => quoteArg('C:\\a" & calc')).toThrow(/unsafe/);
    expect(() => taskXml({ ...spec, args: ['a\nb'] }, 'x')).toThrow(/unsafe/);
    expect(taskXml(spec, '<x & y>')).toContain('<Description>&lt;x &amp; y&gt;</Description>');
    expect(runner.calls).toHaveLength(0);
  });

  it('formats local wall-clock time without a zone', () => {
    expect(localIso(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02T03:04:05');
  });
});

describe('event log (M8-T04, IMP-028)', () => {
  it('writes an Application error from source UniWake and never throws', async () => {
    const { runner, wc } = control();
    runner.on('eventcreate.exe', ok());
    await wc.logError('A porta 47100 já está em uso por outro programa.');
    expect(runner.calls[0]).toMatchObject({
      file: 'C:\\Windows\\System32\\eventcreate.exe',
      args: [
        '/L',
        'APPLICATION',
        '/T',
        'ERROR',
        '/SO',
        'UniWake',
        '/ID',
        '1',
        '/D',
        'A porta 47100 já está em uso por outro programa.',
      ],
    });
    runner.on('eventcreate.exe', () => new Error('spawn failed'));
    await expect(wc.logError('x'.repeat(5000))).resolves.toBeUndefined();
    expect(runner.calls[1]!.args.at(-1)).toHaveLength(1000);
  });
});

// Contract with the real sc.exe (read-only: queries only, nothing is started or stopped).
describe.runIf(process.platform === 'win32')('sc.exe on this Windows (contract)', () => {
  it('reads a running built-in service and a missing one in this Windows language', async () => {
    const { NodeProcessRunner } = await import('../src/adapters/process-runner');
    const dir = mkdtempSync(join(tmpdir(), 'uniwake-wc-'));
    dirs.push(dir);
    const wc = new WindowsControl(new NodeProcessRunner(), dir);
    expect(await wc.serviceState('Dhcp')).toBe('running');
    expect(await wc.serviceState('UniWakeNaoExiste')).toBe('missing');
  });
});
