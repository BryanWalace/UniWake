/**
 * Windows control used by the updater and the hub (ADR-021, ADR-023, IMP-028): service state and
 * start/stop through `sc.exe`, one-shot scheduled tasks through `schtasks.exe` with a task XML (ISO
 * 8601 times, so the result does not depend on the Windows language or date format), and the
 * Application event log through `eventcreate.exe`. Every call uses an argument array with an
 * absolute System32 path (plan §9.1); outputs are read by numeric codes, never by localized text.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { win32 } from 'node:path';
import type { ProcessRunner } from '../application/ports';

export type ServiceState =
  'running' | 'stopped' | 'start_pending' | 'stop_pending' | 'missing' | 'unknown';

const SC_STATES: Record<number, ServiceState> = {
  1: 'stopped',
  2: 'start_pending',
  3: 'stop_pending',
  4: 'running',
  5: 'running', // continue pending
  6: 'stopped', // pause pending
  7: 'stopped', // paused
};
const ERROR_SERVICE_DOES_NOT_EXIST = 1060;
const ERROR_SERVICE_ALREADY_RUNNING = 1056;
const ERROR_SERVICE_NOT_ACTIVE = 1062;

/** `sc query` output → state, from the numeric code after "STATE" (any Windows language). */
export function parseScState(output: string, exitCode: number): ServiceState {
  if (exitCode === ERROR_SERVICE_DOES_NOT_EXIST) return 'missing';
  // The label is localized ("STATE", "ESTADO"); the code and its constant name are not.
  const m =
    /:\s*([1-7])\s+(?:STOPPED|START_PENDING|STOP_PENDING|RUNNING|CONTINUE_PENDING|PAUSE_PENDING|PAUSED)\b/.exec(
      output,
    );
  return m ? (SC_STATES[Number(m[1])] ?? 'unknown') : 'unknown';
}

/** Characters a task XML value may not contain unescaped. */
const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One Windows command-line argument. Paths are the only arguments here; a double quote cannot be
 * part of a Windows path, so it is refused instead of escaped.
 */
export function quoteArg(arg: string): string {
  if (arg.includes('"') || /[\r\n]/.test(arg)) throw new Error(`unsafe task argument: ${arg}`);
  return /\s/.test(arg) || arg === '' ? `"${arg}"` : arg;
}

/** Local wall-clock time as the task scheduler expects it (no zone: the computer's own). */
export function localIso(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`;
}

export interface TaskSpec {
  exe: string;
  args: readonly string[];
  workingDir: string;
  /** When the task starts by itself; it can also be started at once with `run`. */
  at: Date;
}

/** Task Scheduler XML for a one-shot task run as SYSTEM (ADR-023). */
export function taskXml(spec: TaskSpec, description: string): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xmlEscape(description)}</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${localIso(spec.at)}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="System">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="System">
    <Exec>
      <Command>${xmlEscape(quoteArg(spec.exe))}</Command>
      <Arguments>${xmlEscape(spec.args.map(quoteArg).join(' '))}</Arguments>
      <WorkingDirectory>${xmlEscape(spec.workingDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export class WindowsControl {
  private readonly sys: string;

  constructor(
    private readonly runner: ProcessRunner,
    /** Where task XML files are written (inside the data dir). */
    private readonly workDir: string,
    systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  ) {
    this.sys = win32.join(systemRoot, 'System32');
  }

  private exe(name: string) {
    return win32.join(this.sys, name);
  }

  async serviceState(name: string): Promise<ServiceState> {
    const r = await this.runner.run(this.exe('sc.exe'), ['query', name], { timeoutMs: 15_000 });
    return parseScState(r.stdout, r.exitCode);
  }

  /** Asks the service to stop; already stopped counts as done. */
  async stopService(name: string): Promise<void> {
    const r = await this.runner.run(this.exe('sc.exe'), ['stop', name], { timeoutMs: 15_000 });
    if (r.exitCode !== 0 && r.exitCode !== ERROR_SERVICE_NOT_ACTIVE) {
      throw new Error(`sc stop ${name} failed (${r.exitCode})`);
    }
  }

  /** Asks the service to start; already running counts as done. */
  async startService(name: string): Promise<void> {
    const r = await this.runner.run(this.exe('sc.exe'), ['start', name], { timeoutMs: 15_000 });
    if (r.exitCode !== 0 && r.exitCode !== ERROR_SERVICE_ALREADY_RUNNING) {
      throw new Error(`sc start ${name} failed (${r.exitCode})`);
    }
  }

  /** Registers (or replaces) a one-shot SYSTEM task from its XML (ADR-023). */
  async createTask(name: string, spec: TaskSpec, description: string): Promise<void> {
    if (!/^UniWake-[A-Za-z]+$/.test(name)) throw new Error(`unexpected task name: ${name}`);
    mkdirSync(this.workDir, { recursive: true });
    const file = win32.join(this.workDir, `${name}.xml`);
    // schtasks reads task XML as UTF-16 with a byte order mark.
    writeFileSync(file, `\ufeff${taskXml(spec, description)}`, 'utf16le');
    const r = await this.runner.run(
      this.exe('schtasks.exe'),
      ['/Create', '/TN', name, '/XML', file, '/F'],
      { timeoutMs: 30_000 },
    );
    if (r.exitCode !== 0) throw new Error(`schtasks /Create ${name} failed (${r.exitCode})`);
  }

  async runTask(name: string): Promise<void> {
    const r = await this.runner.run(this.exe('schtasks.exe'), ['/Run', '/TN', name], {
      timeoutMs: 30_000,
    });
    if (r.exitCode !== 0) throw new Error(`schtasks /Run ${name} failed (${r.exitCode})`);
  }

  /** Removes a task; a task that does not exist is fine. */
  async deleteTask(name: string): Promise<void> {
    await this.runner.run(this.exe('schtasks.exe'), ['/Delete', '/TN', name, '/F'], {
      timeoutMs: 30_000,
    });
  }

  /** Error entry in the Application log, source "UniWake" (IMP-028). Never throws. */
  async logError(message: string): Promise<void> {
    try {
      await this.runner.run(
        this.exe('eventcreate.exe'),
        [
          '/L',
          'APPLICATION',
          '/T',
          'ERROR',
          '/SO',
          'UniWake',
          '/ID',
          '1',
          '/D',
          message.slice(0, 1000),
        ],
        { timeoutMs: 10_000 },
      );
    } catch {
      // The event log is a second copy of a message already written to the log file.
    }
  }
}
