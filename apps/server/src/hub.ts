/**
 * Hub composition (plan §2.1): wires config, logger, database and both HTTP listeners.
 * `main.ts` adds process concerns (CLI, signals, exit codes); tests drive `createHub` directly.
 */
import { mkdirSync } from 'node:fs';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { createFileLogger } from './adapters/logger';
import { SystemClock } from './adapters/system-clock';
import type { Clock } from './application/ports';
import { type Config, dataPaths } from './config';
import { Db } from './db/connection';
import { migrate } from './db/migrate';
import { buildApp } from './http/app';
import { registerAgentRoutes, registerPanelRoutes } from './http/panel';
import { LOOPBACK_HOSTS } from './http/security';
import { createServices, type Services } from './services';
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

function panelHosts(): ReadonlySet<string> {
  return new Set<string>(LOOPBACK_HOSTS);
}

export async function createHub(opts: HubOptions): Promise<Hub> {
  const { config } = opts;
  const paths = dataPaths(config.dataDir);
  mkdirSync(paths.dbDir, { recursive: true });
  const logger = opts.logger ?? createFileLogger(paths.logs, config.logLevel, config.demo);

  const clock = opts.clock ?? new SystemClock();
  const db = new Db(paths.db);
  try {
    const m = migrate(db, undefined, { now: () => clock.now() });
    if (m.applied.length > 0) logger.info({ from: m.from, to: m.to }, 'database migrated');
  } catch (e) {
    db.close();
    throw e;
  }

  const services = createServices(db, clock);

  const panel = await buildApp({
    kind: 'panel',
    logger: logger.child({ listener: 'panel' }),
    hosts: panelHosts,
    register: (app) => registerPanelRoutes(app, services),
  });
  const agent = await buildApp({
    kind: 'agent',
    logger: logger.child({ listener: 'agent' }),
    hosts: 'any',
    bodyLimit: 8 * 1024,
    register: (app) => registerAgentRoutes(app),
  });

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
    panel,
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
      logger.info(
        { version: APP_VERSION, ...hub.addresses(), demo: config.demo },
        'UniWake hub started',
      );
    },
    async stop() {
      await Promise.allSettled([panel.close(), agent.close()]);
      db.close();
      if (started) logger.info({}, 'UniWake hub stopped');
      started = false;
    },
  };
  return hub;
}
