/**
 * updater.mjs entry (ADR-023): `node updater.mjs [--watchdog] <dataDir>\updates\update-plan.json`.
 * Run by Task Scheduler as SYSTEM; the plan is re-validated before anything happens.
 */
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { NodeFileSystem } from '../adapters/node-fs';
import { NodeProcessRunner } from '../adapters/process-runner';
import { WindowsControl } from '../adapters/windows-control';
import { parsePlan, type UpdatePlan } from '../application/update/plan';
import { Updater, type UpdaterPorts } from './updater';

export function realPorts(plan: UpdatePlan): UpdaterPorts {
  const fs = new NodeFileSystem();
  const runner = new NodeProcessRunner();
  const control = new WindowsControl(runner, `${plan.dataDir}\\updates`);
  const logFile = `${plan.dataDir}\\logs\\updater.log`;
  return {
    serviceState: (name) => control.serviceState(name),
    stopService: (name) => control.stopService(name),
    startService: (name) => control.startService(name),
    deleteTask: (name) => control.deleteTask(name),
    runInstaller: async (file, args, timeoutMs) =>
      (await runner.run(file, args, { timeoutMs })).exitCode,
    health: async (url) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        return r.ok ? (((await r.json()) as { status?: string }).status ?? null) : null;
      } catch {
        return null;
      }
    },
    readText: (p) => fs.readText(p),
    writeText: (p, c) => fs.writeText(p, c),
    exists: (p) => fs.exists(p),
    restoreDatabase: (backup, db) => {
      for (const extra of ['-wal', '-shm']) rmSync(`${db}${extra}`, { force: true });
      copyFileSync(backup, db);
      return Promise.resolve();
    },
    schemaVersion: (db) => {
      try {
        const conn = new DatabaseSync(db, { readOnly: true });
        try {
          const row = conn.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as
            { v: number | null } | undefined;
          return Promise.resolve(row?.v ?? null);
        } finally {
          conn.close();
        }
      } catch {
        return Promise.resolve(null);
      }
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (msg, data) => {
      try {
        mkdirSync(`${plan.dataDir}\\logs`, { recursive: true });
        appendFileSync(
          logFile,
          `${JSON.stringify({ time: new Date().toISOString(), msg, ...(data ?? {}) })}\n`,
        );
      } catch {
        // Logging must never stop an update or a rollback.
      }
    },
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const watchdog = argv[0] === '--watchdog';
  const planPath = watchdog ? argv[1] : argv[0];
  if (!planPath || !/\\updates\\update-plan\.json$/i.test(planPath)) {
    process.stderr.write('usage: updater.mjs [--watchdog] <dataDir>\\updates\\update-plan.json\n');
    return 64;
  }
  let plan: UpdatePlan;
  try {
    plan = parsePlan(readFileSync(planPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`invalid update plan: ${String(e)}\n`);
    return 65;
  }
  if (planPath.toLowerCase() !== `${plan.dataDir}\\updates\\update-plan.json`.toLowerCase()) {
    process.stderr.write('update plan is not in its own data dir\n');
    return 65;
  }
  const updater = new Updater(plan, realPorts(plan));
  const outcome = watchdog ? await updater.watchdog() : await updater.run();
  return outcome === null || outcome.result === 'success' ? 0 : 1;
}

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
