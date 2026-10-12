/**
 * Process entry point: CLI flags, config, signals and exit codes.
 *   node server.mjs [--demo] [--data-dir <dir>] [--version]
 *   node server.mjs --export <file> [--sections a,b] [--password-env VAR] [--data-dir <dir>]
 *   node server.mjs --import <file> --mode merge|replace [--password-env VAR] [--data-dir <dir>]
 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePrepareScriptPath } from './adapters/prepare-script';
import { resolveAgentScriptsDir } from './adapters/agent-scripts';
import { GitHubReleaseSource } from './adapters/github-release-source';
import { resolveOuiPath } from './adapters/oui-file';
import { GitHubTimeCheck } from './adapters/github-time';
import { AllowlistHttpClient } from './adapters/http-client';
import { NodeProcessRunner } from './adapters/process-runner';
import { TaskUpdateLauncher } from './adapters/update-launcher';
import { WindowsControl } from './adapters/windows-control';
import { WindowsHostChecks } from './adapters/windows-host';
import { DevSecretProtector, DpapiSecretProtector } from './adapters/secret-protector';
import { SystemClock } from './adapters/system-clock';
import { type CliIo, EXIT_USAGE, panelAnswers, runExport, runImport } from './cli/migration-cli';
import { ConfigError, dataPaths, resolveConfig } from './config';
import { Db } from './db/connection';
import {
  createHub,
  EXIT_CONFIG_ERROR,
  HubStartError,
  resolveHelperPath,
  resolveInstallDir,
} from './hub';

/** Asks the service manager for a restart (WinSW restarts on a non-zero exit). */
export const EXIT_RESTART = 75;
import { resolveWebDir } from './http/static';
import { UPDATE_API, UPDATE_REPO, updateHosts } from './update-source';
import { APP_VERSION } from './version';

export interface CliArgs {
  demo: boolean;
  dataDir?: string;
  version: boolean;
  /** v1.4 (FR-406): write a .uniwake file and exit. */
  export?: string;
  /** v1.4 (FR-406): import a .uniwake file (service stopped) and exit. */
  import?: string;
  mode?: string;
  sections?: string;
  passwordEnv?: string;
}

const VALUE_FLAGS = {
  '--data-dir': 'dataDir',
  '--export': 'export',
  '--import': 'import',
  '--mode': 'mode',
  '--sections': 'sections',
  '--password-env': 'passwordEnv',
} as const;

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { demo: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') args.demo = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a !== undefined && a in VALUE_FLAGS) {
      const v = argv[++i];
      if (!v) throw new ConfigError(`${a} requires a value`);
      args[VALUE_FLAGS[a as keyof typeof VALUE_FLAGS]] = v;
    } else throw new ConfigError(`unknown argument: ${a}`);
  }
  return args;
}

function readConfigFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export interface MainOptions {
  /** Where start-up failures are reported besides stderr (IMP-028); injectable for tests. */
  eventLog?: (message: string) => Promise<void>;
  /** CLI import (tests): whether a hub answers on the panel port. */
  hubRunning?: (port: number) => Promise<boolean>;
  /** CLI (tests): output and environment. */
  io?: CliIo;
}

/** The Windows Application event log for a real hub; nothing in demo mode or elsewhere. */
function defaultEventLog(demo: boolean): (message: string) => Promise<void> {
  if (process.platform !== 'win32' || demo) return () => Promise.resolve();
  const control = new WindowsControl(new NodeProcessRunner(), tmpdir());
  return (message) => control.logError(message);
}

export async function main(argv: readonly string[], opts: MainOptions = {}): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`UniWake: ${(e as Error).message}\n`);
    return EXIT_CONFIG_ERROR;
  }
  if (args.version) {
    process.stdout.write(`${APP_VERSION}\n`);
    return 0;
  }

  if (args.export || args.import) return migrationCli(args, opts);

  try {
    const env = process.env;
    const probe = resolveConfig(null, env, args.dataDir ? { dataDir: args.dataDir } : {});
    const config = resolveConfig(readConfigFile(dataPaths(probe.dataDir).config), env, {
      dataDir: probe.dataDir,
      demo: args.demo || probe.demo,
    });
    const installDir = config.demo ? null : resolveInstallDir(import.meta.dirname);
    const hub = await createHub({
      config,
      webDir: resolveWebDir(env, import.meta.dirname),
      helperPath: resolveHelperPath(import.meta.dirname),
      neighborScriptPath: resolveHelperPath(import.meta.dirname, 'get-neighbors.ps1'),
      ouiPath: resolveOuiPath(import.meta.dirname),
      installDir,
      updateLauncher:
        installDir && process.platform === 'win32'
          ? new TaskUpdateLauncher(
              new WindowsControl(new NodeProcessRunner(), dataPaths(config.dataDir).updates),
              process.execPath,
              join(import.meta.dirname, 'updater.mjs'),
            )
          : null,
      // After a restore request: exit with 75 so the service manager starts us again (FR-014).
      requestRestart: () => {
        setTimeout(() => void hub.stop().finally(() => process.exit(EXIT_RESTART)), 500);
      },
      certScriptPath: resolveHelperPath(import.meta.dirname, 'new-panel-cert.ps1'),
      prepareScriptPath: resolvePrepareScriptPath(import.meta.dirname),
      agentScriptsDir: resolveAgentScriptsDir(import.meta.dirname),
      // E2E (demo mode only): keep Modo equipe on loopback, never broadcasting on the real LAN.
      ...(config.demo ? demoTeamHooks(env) : {}),
      // Real health checks only for a real hub (never in demo mode or tests).
      ...(config.demo
        ? {}
        : {
            timeCheck: new GitHubTimeCheck(),
            releaseSource: new GitHubReleaseSource(
              new AllowlistHttpClient(updateHosts()),
              UPDATE_API,
              UPDATE_REPO,
            ),
            hostChecks:
              process.platform === 'win32' ? new WindowsHostChecks(new NodeProcessRunner()) : null,
          }),
    });
    await hub.start();

    await new Promise<void>((resolve) => {
      let stopping = false;
      const stop = (signal: string) => {
        if (stopping) return;
        stopping = true;
        hub.logger.info({ signal }, 'shutdown requested');
        const timer = setTimeout(() => {
          hub.logger.error({}, 'graceful shutdown timed out');
          resolve();
        }, 15_000);
        void hub.stop().finally(() => {
          clearTimeout(timer);
          resolve();
        });
      };
      process.once('SIGINT', () => stop('SIGINT'));
      process.once('SIGTERM', () => stop('SIGTERM'));
      process.once('SIGBREAK', () => stop('SIGBREAK'));
    });
    return 0;
  } catch (e) {
    if (e instanceof HubStartError || e instanceof ConfigError) {
      process.stderr.write(`UniWake: ${e.message}\n`);
      // IMP-028: a service that cannot start is diagnosed from the Event Viewer too.
      await (opts.eventLog ?? defaultEventLog(args.demo))(`O UniWake não iniciou: ${e.message}`);
      return EXIT_CONFIG_ERROR;
    }
    process.stderr.write(`UniWake: fatal error: ${(e as Error).stack ?? String(e)}\n`);
    return 1;
  }
}

/** `--export` / `--import` (FR-406, ADR-052): no listener is opened. */
async function migrationCli(args: CliArgs, opts: MainOptions): Promise<number> {
  const io: CliIo = opts.io ?? {
    out: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`UniWake: ${l}\n`),
    env: process.env,
  };
  if (args.export && args.import) {
    io.err('Use --export ou --import, não os dois.');
    return EXIT_USAGE;
  }
  let config;
  try {
    const probe = resolveConfig(null, io.env, args.dataDir ? { dataDir: args.dataDir } : {});
    config = resolveConfig(readConfigFile(dataPaths(probe.dataDir).config), io.env, {
      dataDir: probe.dataDir,
    });
  } catch (e) {
    io.err((e as Error).message);
    return EXIT_USAGE;
  }
  if (args.export) {
    const path = dataPaths(config.dataDir).db;
    if (!existsSync(path)) {
      io.err(`Banco do UniWake não encontrado em ${path}.`);
      return EXIT_USAGE;
    }
    const db = new Db(path);
    try {
      return await runExport(
        {
          file: args.export,
          sections: args.sections,
          passwordEnv: args.passwordEnv,
          db,
          protector:
            process.platform === 'win32'
              ? new DpapiSecretProtector(new NodeProcessRunner())
              : new DevSecretProtector(),
          clock: new SystemClock(),
          version: APP_VERSION,
        },
        io,
      );
    } finally {
      db.close();
    }
  }
  return runImport(
    {
      file: args.import!,
      mode: args.mode,
      passwordEnv: args.passwordEnv,
      config,
      hubRunning: opts.hubRunning ?? panelAnswers,
      openHub: () => createHub({ config }),
    },
    io,
  );
}

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}

/** UNIWAKE_SYNC_BIND / UNIWAKE_TEAM_ANNOUNCE (host:port,…): honoured in demo mode only. */
function demoTeamHooks(env: NodeJS.ProcessEnv): {
  syncBind?: string;
  teamAnnounceTargets?: () => { host: string; port: number }[];
} {
  const targets = (env.UNIWAKE_TEAM_ANNOUNCE ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [host, port] = t.split(':');
      return { host: host!, port: Number(port) };
    })
    .filter((t) => t.host !== '' && Number.isInteger(t.port) && t.port > 0);
  return {
    ...(env.UNIWAKE_SYNC_BIND ? { syncBind: env.UNIWAKE_SYNC_BIND } : {}),
    ...(env.UNIWAKE_TEAM_ANNOUNCE !== undefined ? { teamAnnounceTargets: () => targets } : {}),
  };
}
