/**
 * Read-only Windows checks for the health page (FR-012, IMP-013/022). Values are read as hex
 * numbers, never by their (localized) labels, so pt-BR and en-US Windows parse the same.
 */
import { win32 } from 'node:path';
import type { HostChecks, HostFacts } from '../application/health/health-service';
import type { ProcessRunner } from '../application/ports';

/** powercfg /query … STANDBYIDLE: the last two hex values are the AC and DC indexes (seconds). */
export function parseSleepOnAc(powercfg: string): boolean | null {
  const hex = [...powercfg.matchAll(/0x([0-9a-f]{8})/gi)].map((m) => parseInt(m[1]!, 16));
  if (hex.length < 2) return null;
  return hex[hex.length - 2]! !== 0;
}

/** A REG_DWORD value from `reg query … /v Name`. */
export function parseRegDword(regOutput: string, name: string): number | null {
  const line = regOutput
    .split(/\r?\n/)
    .find((l) => l.trim().toLowerCase().startsWith(name.toLowerCase()));
  const m = line?.match(/0x([0-9a-f]+)/i);
  return m ? parseInt(m[1]!, 16) : null;
}

const REBOOT_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending',
];
const ACTIVE_HOURS_KEY = 'HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings';

export class WindowsHostChecks implements HostChecks {
  private readonly sys: string;

  constructor(
    private readonly runner: ProcessRunner,
    systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  ) {
    this.sys = win32.join(systemRoot, 'System32');
  }

  private async run(exe: string, args: string[]) {
    try {
      return await this.runner.run(win32.join(this.sys, exe), args, { timeoutMs: 10_000 });
    } catch {
      return null;
    }
  }

  async check(): Promise<HostFacts> {
    const power = await this.run('powercfg.exe', [
      '/query',
      'SCHEME_CURRENT',
      'SUB_SLEEP',
      'STANDBYIDLE',
    ]);
    let pendingReboot: boolean | null = false;
    for (const key of REBOOT_KEYS) {
      const r = await this.run('reg.exe', ['query', key]);
      if (r === null) pendingReboot = null;
      else if (r.exitCode === 0) {
        pendingReboot = true;
        break;
      }
    }
    const hours = await this.run('reg.exe', ['query', ACTIVE_HOURS_KEY]);
    const start = hours?.exitCode === 0 ? parseRegDword(hours.stdout, 'ActiveHoursStart') : null;
    const end = hours?.exitCode === 0 ? parseRegDword(hours.stdout, 'ActiveHoursEnd') : null;
    return {
      sleepOnAc: power?.exitCode === 0 ? parseSleepOnAc(power.stdout) : null,
      pendingReboot,
      activeHours: start !== null && end !== null ? { start, end } : null,
    };
  }
}
