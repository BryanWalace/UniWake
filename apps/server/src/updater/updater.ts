/**
 * The updater (FR-001.3, ADR-023, plan §8). Started by Task Scheduler as SYSTEM, outside the
 * service's process tree, with the plan the hub wrote: stop the service, run the installer
 * silently, start it, and wait for a healthy hub running the new version; otherwise roll back to
 * the previous version directory (restoring the database only if the new version migrated it).
 * The watchdog task (15 min later) restores the previous version if an updater died midway
 * (IMP-027, AC-001-13). Progress goes to update-state.json; the outcome to update-result.json,
 * which the hub reads at its next start.
 */
import type { UpdatePlan } from '../application/update/plan';

export type UpdateOutcome =
  | { result: 'success'; version: string; at: number }
  | { result: 'rolled_back'; version: string; reason: RollbackReason; at: number }
  | { result: 'failed'; version: string; reason: 'STOP_TIMEOUT'; at: number };

export type RollbackReason =
  'INSTALLER_FAILED' | 'HEALTH_TIMEOUT' | 'WRONG_VERSION' | 'INTERRUPTED';

export interface UpdaterPorts {
  serviceState(name: string): Promise<string>;
  stopService(name: string): Promise<void>;
  startService(name: string): Promise<void>;
  deleteTask(name: string): Promise<void>;
  /** Runs the installer; resolves with its exit code, rejects on timeout. */
  runInstaller(file: string, args: string[], timeoutMs: number): Promise<number>;
  /** `status` from GET healthUrl, or null when the hub does not answer. */
  health(url: string): Promise<string | null>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Replaces the database with the backup (and drops its -wal/-shm files). */
  restoreDatabase(backupFile: string, dbFile: string): Promise<void>;
  /** Highest applied migration of the database file, null if it cannot be read. */
  schemaVersion(dbFile: string): Promise<number | null>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(msg: string, data?: object): void;
}

export const TASK_UPDATER = 'UniWake-Updater';
export const TASK_WATCHDOG = 'UniWake-Watchdog';
const STOP_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const HEALTH_TIMEOUT_MS = 120_000;
const POLL_MS = 2_000;

const win = (...parts: string[]) => parts.join('\\');

export function paths(plan: UpdatePlan) {
  const updates = win(plan.dataDir, 'updates');
  return {
    xml: win(plan.installDir, 'UniWakeService.xml'),
    state: win(updates, 'update-state.json'),
    result: win(updates, 'update-result.json'),
    installerLog: win(updates, 'installer.log'),
    db: win(plan.dataDir, 'data', 'uniwake.db'),
  };
}

/** The version UniWakeService.xml runs, from `versions\<ver>\node.exe`. */
export function xmlVersion(xml: string): string | null {
  return /\\versions\\([^\\<"]+)\\node\.exe/i.exec(xml)?.[1] ?? null;
}

/** Points every `versions\<from>\` in the service XML at `versions\<to>\`. */
export function repointXml(xml: string, from: string, to: string): string {
  // Also `<workingdirectory>…\versions\<from></workingdirectory>`, which has no trailing "\".
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.replace(
    new RegExp(`\\\\versions\\\\${escaped}(?=[\\\\<"])`, 'g'),
    () => `\\versions\\${to}`,
  );
}

export class Updater {
  constructor(
    private readonly plan: UpdatePlan,
    private readonly p: UpdaterPorts,
  ) {}

  private get files() {
    return paths(this.plan);
  }

  private async mark(step: string) {
    this.p.log(`step: ${step}`);
    await this.p.writeText(this.files.state, JSON.stringify({ step, at: this.p.now() }));
  }

  private async finish(outcome: UpdateOutcome): Promise<UpdateOutcome> {
    await this.p.writeText(this.files.result, JSON.stringify(outcome));
    await this.mark('done');
    await this.p.deleteTask(TASK_WATCHDOG).catch(() => undefined);
    this.p.log('finished', outcome);
    return outcome;
  }

  private async waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const until = this.p.now() + timeoutMs;
    for (;;) {
      if (await check().catch(() => false)) return true;
      if (this.p.now() >= until) return false;
      await this.p.sleep(POLL_MS);
    }
  }

  private async stopService(): Promise<boolean> {
    await this.p.stopService(this.plan.serviceName).catch((e: unknown) => {
      this.p.log('stop request failed', { error: String(e) });
    });
    return this.waitFor(async () => {
      const s = await this.p.serviceState(this.plan.serviceName);
      return s === 'stopped' || s === 'missing';
    }, STOP_TIMEOUT_MS);
  }

  private async healthy(version: string): Promise<boolean> {
    return this.waitFor(async () => {
      const status = await this.p.health(this.plan.healthUrl);
      if (status === null || status === 'down') return false;
      return xmlVersion(await this.p.readText(this.files.xml)) === version;
    }, HEALTH_TIMEOUT_MS);
  }

  async run(): Promise<UpdateOutcome> {
    const { plan } = this;
    this.p.log('update start', { from: plan.previousVersion, to: plan.version });
    await this.mark('stopping');
    if (!(await this.stopService())) {
      // Nothing was changed: make sure the current version keeps running.
      await this.p.startService(plan.serviceName).catch(() => undefined);
      return this.finish({
        result: 'failed',
        version: plan.previousVersion,
        reason: 'STOP_TIMEOUT',
        at: this.p.now(),
      });
    }
    await this.mark('installing');
    let code: number | null;
    try {
      code = await this.p.runInstaller(
        plan.installer,
        [
          '/VERYSILENT',
          '/SUPPRESSMSGBOXES',
          '/NORESTART',
          '/CLOSEAPPLICATIONS',
          `/LOG=${this.files.installerLog}`,
        ],
        INSTALL_TIMEOUT_MS,
      );
    } catch (e) {
      this.p.log('installer did not finish', { error: String(e) });
      code = null;
    }
    if (code !== 0) return this.rollback('INSTALLER_FAILED');
    await this.mark('starting');
    await this.p.startService(plan.serviceName).catch(() => undefined);
    if (!(await this.healthy(plan.version))) {
      const running = xmlVersion(await this.p.readText(this.files.xml).catch(() => ''));
      return this.rollback(running === plan.version ? 'HEALTH_TIMEOUT' : 'WRONG_VERSION');
    }
    return this.finish({ result: 'success', version: plan.version, at: this.p.now() });
  }

  /** Back to the previous version directory; the database only if it was migrated (ADR-023). */
  async rollback(reason: RollbackReason): Promise<UpdateOutcome> {
    const { plan } = this;
    await this.mark(`rollback:${reason}`);
    await this.stopService();
    const xml = await this.p.readText(this.files.xml);
    const current = xmlVersion(xml);
    if (current && current !== plan.previousVersion) {
      await this.p.writeText(this.files.xml, repointXml(xml, current, plan.previousVersion));
    }
    const schema = await this.p.schemaVersion(this.files.db);
    if (plan.backupFile && schema !== null && schema > plan.schemaVersion) {
      if (await this.p.exists(plan.backupFile)) {
        await this.p.restoreDatabase(plan.backupFile, this.files.db);
        this.p.log('database restored', { from: plan.backupFile, schema });
      } else {
        this.p.log('pre-update backup missing; database kept', { file: plan.backupFile });
      }
    }
    await this.p.startService(plan.serviceName).catch(() => undefined);
    await this.healthy(plan.previousVersion);
    return this.finish({
      result: 'rolled_back',
      version: plan.previousVersion,
      reason,
      at: this.p.now(),
    });
  }

  /**
   * Watchdog (IMP-027): runs 15 minutes after the updater started. If the update never finished
   * and the service is not running, the previous version comes back.
   */
  async watchdog(): Promise<UpdateOutcome | null> {
    if (await this.p.exists(this.files.result)) {
      await this.p.deleteTask(TASK_WATCHDOG).catch(() => undefined);
      return null; // the updater finished
    }
    const state = await this.p.serviceState(this.plan.serviceName);
    if (state === 'running' && (await this.p.health(this.plan.healthUrl)) !== null) {
      // The updater died after the service came back: record what is running.
      const running = xmlVersion(await this.p.readText(this.files.xml));
      this.p.log('watchdog: service is running', { running });
      return this.finish(
        running === this.plan.version
          ? { result: 'success', version: running, at: this.p.now() }
          : {
              result: 'rolled_back',
              version: running ?? this.plan.previousVersion,
              reason: 'INTERRUPTED',
              at: this.p.now(),
            },
      );
    }
    this.p.log('watchdog: update interrupted, restoring the previous version', { state });
    return this.rollback('INTERRUPTED');
  }
}
