/**
 * Starts the updater outside the service's process tree (ADR-023): a watchdog task 15 minutes out
 * and the updater task, both SYSTEM, both running this version's node.exe and updater.mjs with the
 * plan path as their only data.
 */
import { dirname } from 'node:path';
import type { UpdateLauncher } from '../application/update/update-coordinator';
import type { WindowsControl } from './windows-control';

export const WATCHDOG_DELAY_MS = 15 * 60_000;

export class TaskUpdateLauncher implements UpdateLauncher {
  constructor(
    private readonly control: Pick<WindowsControl, 'createTask' | 'runTask'>,
    private readonly nodeExe: string,
    private readonly updaterScript: string,
    private readonly now: () => number = Date.now,
  ) {}

  async launch(planFile: string): Promise<void> {
    const now = this.now();
    const base = { exe: this.nodeExe, workingDir: dirname(planFile) };
    await this.control.createTask(
      'UniWake-Watchdog',
      {
        ...base,
        args: [this.updaterScript, '--watchdog', planFile],
        at: new Date(now + WATCHDOG_DELAY_MS),
      },
      'UniWake: restaura a versão anterior se a atualização não terminar.',
    );
    await this.control.createTask(
      'UniWake-Updater',
      { ...base, args: [this.updaterScript, planFile], at: new Date(now + 60_000) },
      'UniWake: instala a atualização baixada.',
    );
    await this.control.runTask('UniWake-Updater');
  }
}
