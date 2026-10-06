/**
 * Process entry point: CLI flags, config, signals and exit codes.
 *   node server.mjs [--demo] [--data-dir <dir>] [--version]
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolvePrepareScriptPath } from './adapters/prepare-script';
import { GitHubReleaseSource } from './adapters/github-release-source';
import { GitHubTimeCheck } from './adapters/github-time';
import { AllowlistHttpClient } from './adapters/http-client';
import { NodeProcessRunner } from './adapters/process-runner';
import { WindowsControl } from './adapters/windows-control';
import { WindowsHostChecks } from './adapters/windows-host';
import { ConfigError, dataPaths, resolveConfig } from './config';
import { createHub, EXIT_CONFIG_ERROR, HubStartError, resolveHelperPath } from './hub';

/** Asks the service manager for a restart (WinSW restarts on a non-zero exit). */
export const EXIT_RESTART = 75;
import { resolveWebDir } from './http/static';
import { UPDATE_API, UPDATE_REPO, updateHosts } from './update-source';
import { APP_VERSION } from './version';

export interface CliArgs {
  demo: boolean;
  dataDir?: string;
  version: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { demo: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') args.demo = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--data-dir') {
      const v = argv[++i];
      if (!v) throw new ConfigError('--data-dir requires a path');
      args.dataDir = v;
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

  try {
    const env = process.env;
    const probe = resolveConfig(null, env, args.dataDir ? { dataDir: args.dataDir } : {});
    const config = resolveConfig(readConfigFile(dataPaths(probe.dataDir).config), env, {
      dataDir: probe.dataDir,
      demo: args.demo || probe.demo,
    });
    const hub = await createHub({
      config,
      webDir: resolveWebDir(env, import.meta.dirname),
      helperPath: resolveHelperPath(import.meta.dirname),
      // After a restore request: exit with 75 so the service manager starts us again (FR-014).
      requestRestart: () => {
        setTimeout(() => void hub.stop().finally(() => process.exit(EXIT_RESTART)), 500);
      },
      certScriptPath: resolveHelperPath(import.meta.dirname, 'new-panel-cert.ps1'),
      prepareScriptPath: resolvePrepareScriptPath(import.meta.dirname),
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

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
