/**
 * Hub composition (plan §2.1): wires config, logger, database and both HTTP listeners.
 * `main.ts` adds process concerns (CLI, signals, exit codes); tests drive `createHub` directly.
 */
import { mkdirSync } from 'node:fs';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { createFileLogger } from './adapters/logger';
import { OsDnsResolver } from './adapters/dns-resolver';
import { OsNetworkInterfaces } from './adapters/network-interfaces';
import { NodeProcessRunner } from './adapters/process-runner';
import { RecordingPacketSender } from './adapters/recording-packet-sender';
import { SystemClock } from './adapters/system-clock';
import { TcpProber } from './adapters/tcp-prober';
import { UdpPacketSender } from './adapters/udp-packet-sender';
import type { Clock } from './application/ports';
import { type Config, dataPaths } from './config';
import { Db } from './db/connection';
import { migrate } from './db/migrate';
import { buildApp } from './http/app';
import { registerAgentRoutes, registerPanelRoutes } from './http/panel';
import { LOOPBACK_HOSTS } from './http/security';
import { registerStatic } from './http/static';
import { createServices, type ServicePorts, type Services } from './services';
import { APP_VERSION } from './version';

/** Exit code for configuration/startup errors such as a port already in use (plan §9). */
export const EXIT_CONFIG_ERROR = 78;

export class HubStartError extends Error {
  readonly exitCode = EXIT_CONFIG_ERROR;
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'HubStartError';
  }
}

export interface HubOptions {
  config: Config;
  /** Logger override (tests); defaults to the rotating file logger in the data dir. */
  logger?: FastifyBaseLogger;
  clock?: Clock;
  /** Built web panel to serve (null/undefined = API only). */
  webDir?: string | null;
  /** Port overrides (tests); defaults to the real adapters. */
  ports?: ServicePorts;
}

export interface Hub {
  readonly db: Db;
  readonly services: Services;
  readonly panel: FastifyInstance;
  readonly agent: FastifyInstance;
  readonly logger: FastifyBaseLogger;
  /** Bound addresses after `start()`. */
  addresses(): { panel: string; agent: string };
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** M1-F3: an unreadable database must tell the operator what to do (constitution §8). */
function databaseError(dbPath: string, backupsDir: string, cause: unknown): HubStartError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new HubStartError(
    `O banco de dados do UniWake não pôde ser aberto (${detail}). Arquivo: ${dbPath}. ` +
      `Restaure o backup mais recente da pasta ${backupsDir} (copie-o sobre o arquivo acima com o serviço parado) ` +
      'ou mova o arquivo para outro lugar para começar com um banco vazio.',
    cause,
  );
}

function openDatabase(dbPath: string, backupsDir: string): Db {
  try {
    return new Db(dbPath);
  } catch (e) {
    throw databaseError(dbPath, backupsDir, e);
  }
}

function panelHosts(): ReadonlySet<string> {
  return new Set<string>(LOOPBACK_HOSTS);
}

export async function createHub(opts: HubOptions): Promise<Hub> {
  const { config } = opts;
  const paths = dataPaths(config.dataDir);
  mkdirSync(paths.dbDir, { recursive: true });
  const fileLogger = opts.logger
    ? null
    : createFileLogger(paths.logs, config.logLevel, config.demo);
  const logger = opts.logger ?? fileLogger!.logger;

  const clock = opts.clock ?? new SystemClock();
  const db = openDatabase(paths.db, paths.backups);
  try {
    const m = migrate(db, undefined, { now: () => clock.now() });
    if (m.applied.length > 0) logger.info({ from: m.from, to: m.to }, 'database migrated');
  } catch (e) {
    db.close();
    throw databaseError(paths.db, paths.backups, e);
  }

  // Demo mode never constructs the real sender (AC-015-01): no packet can leave the machine.
  const sender = config.demo ? new RecordingPacketSender() : new UdpPacketSender();
  const services = createServices(
    db,
    clock,
    opts.ports ?? {
      interfaces: new OsNetworkInterfaces(new NodeProcessRunner()),
      sender,
      dryRunSender: new RecordingPacketSender(),
      prober: new TcpProber(),
      dns: new OsDnsResolver(),
      logger,
    },
    { demo: config.demo },
  );

  let panel: FastifyInstance | undefined;
  let agent: FastifyInstance;
  try {
    panel = await buildApp({
      kind: 'panel',
      logger: logger.child({ listener: 'panel' }),
      hosts: panelHosts,
      register: async (app) => {
        await registerPanelRoutes(app, services);
        if (opts.webDir) await registerStatic(app, opts.webDir);
      },
    });
    agent = await buildApp({
      kind: 'agent',
      logger: logger.child({ listener: 'agent' }),
      hosts: 'any',
      bodyLimit: 8 * 1024,
      register: (app) => registerAgentRoutes(app),
    });
  } catch (e) {
    // R-M1-01: release what was opened so the DB file is not left locked.
    await panel?.close();
    db.close();
    await fileLogger?.close();
    throw e;
  }

  let started = false;

  async function listen(app: FastifyInstance, name: string, host: string, port: number) {
    try {
      await app.listen({ host, port });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const reason =
        code === 'EADDRINUSE'
          ? `port ${port} on ${host} is already in use by another program`
          : code === 'EADDRNOTAVAIL'
            ? `address ${host} does not exist on this computer`
            : `cannot listen on ${host}:${port} (${code ?? 'unknown error'})`;
      throw new HubStartError(`${name} listener: ${reason}`, e);
    }
  }

  const hub: Hub = {
    db,
    services,
    panel: panel,
    agent,
    logger,
    addresses() {
      const fmt = (app: FastifyInstance) => {
        const a = app.server.address();
        return a && typeof a === 'object' ? `${a.address}:${a.port}` : '';
      };
      return { panel: fmt(panel), agent: fmt(agent) };
    },
    async start() {
      try {
        await listen(panel, 'panel', config.panelBind, config.panelPort);
        await listen(agent, 'agent', config.agentBind, config.agentPort);
      } catch (e) {
        await hub.stop();
        throw e;
      }
      started = true;
      services.runner.recover();
      logger.info(
        { version: APP_VERSION, ...hub.addresses(), demo: config.demo },
        'UniWake hub started',
      );
    },
    async stop() {
      await Promise.allSettled([panel.close(), agent.close()]);
      await sender.close();
      db.close();
      if (started) logger.info({}, 'UniWake hub stopped');
      started = false;
      await fileLogger?.close();
    },
  };
  return hub;
}
