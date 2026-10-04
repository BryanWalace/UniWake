/**
 * Bootstrap configuration (constitution §2.4, plan §9).
 * Precedence: code defaults < `<dataDir>/config.json` < environment variables.
 * Only listener and logging settings live here; everything else is a DB setting.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_SETTINGS } from '@uniwake/shared';

const portSchema = z.coerce.number().int().min(1).max(65535);
const bindSchema = z.union([z.ipv4(), z.literal('localhost')]);

export const fileConfigSchema = z
  .object({
    panelPort: portSchema,
    agentPort: portSchema,
    panelBind: bindSchema,
    agentBind: bindSchema,
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  })
  .partial()
  .strict();

export interface Config {
  dataDir: string;
  panelPort: number;
  agentPort: number;
  panelBind: string;
  agentBind: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Demo mode (FR-015): seed data, dry-run, simulated targets. */
  demo: boolean;
}

export const CONFIG_DEFAULTS: Omit<Config, 'dataDir' | 'demo'> = {
  panelPort: DEFAULT_SETTINGS['bootstrap.panelPort'],
  agentPort: DEFAULT_SETTINGS['bootstrap.agentPort'],
  panelBind: '127.0.0.1',
  agentBind: '0.0.0.0',
  logLevel: DEFAULT_SETTINGS['bootstrap.logLevel'],
};

const ENV_KEYS = {
  panelPort: 'UNIWAKE_PANEL_PORT',
  agentPort: 'UNIWAKE_AGENT_PORT',
  panelBind: 'UNIWAKE_PANEL_BIND',
  agentBind: 'UNIWAKE_AGENT_BIND',
  logLevel: 'UNIWAKE_LOG_LEVEL',
} as const;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Default data dir: `%ProgramData%\UniWake` on Windows, `./.dev-data` elsewhere. */
export function defaultDataDir(env: NodeJS.ProcessEnv): string {
  return env.ProgramData ? join(env.ProgramData, 'UniWake') : join(process.cwd(), '.dev-data');
}

/**
 * Pure resolution of the bootstrap config.
 * @param fileText contents of config.json, or null when the file does not exist.
 */
export function resolveConfig(
  fileText: string | null,
  env: NodeJS.ProcessEnv,
  overrides: { dataDir?: string; demo?: boolean } = {},
): Config {
  let fromFile: z.infer<typeof fileConfigSchema> = {};
  if (fileText !== null && fileText.trim() !== '') {
    let json: unknown;
    try {
      // Notepad saves UTF-8 with a BOM (U+FEFF); JSON.parse rejects it.
      json = JSON.parse(fileText.charCodeAt(0) === 0xfeff ? fileText.slice(1) : fileText);
    } catch (e) {
      throw new ConfigError(`config.json is not valid JSON: ${(e as Error).message}`);
    }
    const parsed = fileConfigSchema.safeParse(json);
    if (!parsed.success) {
      throw new ConfigError(`config.json is invalid: ${z.prettifyError(parsed.error)}`);
    }
    fromFile = parsed.data;
  }

  const fromEnv: Record<string, unknown> = {};
  for (const [key, envName] of Object.entries(ENV_KEYS)) {
    const v = env[envName];
    if (v !== undefined && v !== '') fromEnv[key] = v;
  }
  const envParsed = fileConfigSchema.safeParse(fromEnv);
  if (!envParsed.success) {
    throw new ConfigError(`environment variables are invalid: ${z.prettifyError(envParsed.error)}`);
  }

  return {
    ...CONFIG_DEFAULTS,
    ...fromFile,
    ...envParsed.data,
    dataDir: overrides.dataDir ?? env.UNIWAKE_DATA_DIR ?? defaultDataDir(env),
    demo: overrides.demo ?? env.UNIWAKE_DEMO === '1',
  };
}

/** Layout of the data directory (plan §9). */
export function dataPaths(dataDir: string) {
  return {
    config: join(dataDir, 'config.json'),
    db: join(dataDir, 'data', 'uniwake.db'),
    dbDir: join(dataDir, 'data'),
    backups: join(dataDir, 'backups'),
    logs: join(dataDir, 'logs'),
    updates: join(dataDir, 'updates'),
    certs: join(dataDir, 'certs'),
  };
}
