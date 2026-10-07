/**
 * Hub composition (plan §2.1): wires config, logger, database and both HTTP listeners.
 * `main.ts` adds process concerns (CLI, signals, exit codes); tests drive `createHub` directly.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { WindowsNeighborCache } from './adapters/neighbor-cache';
import { NodeFileSystem } from './adapters/node-fs';
import { OuiFile } from './adapters/oui-file';
import { PrepareScriptFile } from './adapters/prepare-script';
import { createFileLogger } from './adapters/logger';
import { JsonConfigFile } from './adapters/config-file';
import { applyPendingRestore, snapshotBefore } from './db/backups';
import type { HostChecks, TimeCheck } from './application/health/health-service';
import { LogFileReader } from './adapters/log-reader';
import { type PanelCertificate, PanelCertificateStore } from './adapters/panel-certificate';
import { OsDnsResolver } from './adapters/dns-resolver';
import { SimulatedNetwork } from './adapters/simulated-network';
import { seedDemo } from './application/demo/demo-seed';
import { SqliteDemoRepo } from './db/repositories/demo-repo';
import { SqliteDevicesRepo } from './db/repositories/devices-repo';
import { SqliteJobsRepo } from './db/repositories/jobs-repo';
import { SqliteMonitorRepo } from './db/repositories/monitor-repo';
import { SqliteSchedulerRepo } from './db/repositories/scheduler-repo';
import { CompositeProber, PingExeIcmp, powershellSpawner, PsHelperIcmp } from './adapters/icmp';
import { OsNetworkInterfaces } from './adapters/network-interfaces';
import { NodeProcessRunner } from './adapters/process-runner';
import { RecordingPacketSender } from './adapters/recording-packet-sender';
import { SystemClock } from './adapters/system-clock';
import { TcpProber } from './adapters/tcp-prober';
import { UdpPacketSender } from './adapters/udp-packet-sender';
import type { Clock, ReleaseSource } from './application/ports';
import type { UpdateLauncher } from './application/update/update-coordinator';
import { type Config, dataPaths } from './config';
import { Db } from './db/connection';
import { latestSchemaVersion, migrate } from './db/migrate';
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
  /** probe-helper.ps1 location (Windows ICMP, ADR-019); null = TCP probes only. */
  helperPath?: string | null;
  /** new-panel-cert.ps1 location (LAN HTTPS certificate, ADR-026). */
  certScriptPath?: string | null;
  /** helper\\get-neighbors.ps1 (discovery, FR-101); null = arp.exe only. */
  neighborScriptPath?: string | null;
  /** data\\oui.tsv.gz (MAC vendors, FR-101); null = no vendor names. */
  ouiPath?: string | null;
  /** Update source (main.ts on a real install; ADR-025); none in tests and demo mode. */
  releaseSource?: ReleaseSource | null;
  /** `%ProgramFiles%\UniWake` when running from an installed version dir; null from source. */
  installDir?: string | null;
  /** Starts updater.mjs (main.ts on an installed Windows hub). */
  updateLauncher?: UpdateLauncher | null;
  /** scripts/prepare-target.ps1 served to target PCs (FR-007.3); null = not available. */
  prepareScriptPath?: string | null;
  /** Health checks that leave the process (main.ts on a real install); none in tests. */
  hostChecks?: HostChecks | null;
  timeCheck?: TimeCheck | null;
  /** Called after a restore request: stop and start the service again (main.ts). */
  requestRestart?: () => void;
  /** Certificate override (tests): skips the store. */
  panelCertificate?: () => Promise<PanelCertificate>;
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
  addresses(): { panel: string; agent: string; panelLan?: string };
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

/** probe-helper.ps1 next to the bundle (installed, plan §9) or in apps/server/helper (source). */
export function resolveHelperPath(bundleDir: string, file = 'probe-helper.ps1'): string | null {
  const candidates = [join(bundleDir, 'helper', file), join(bundleDir, '..', 'helper', file)];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** `<installDir>\versions\<ver>\server.mjs` (plan §9) → installDir; null when run from source. */
export function resolveInstallDir(bundleDir: string): string | null {
  const versions = dirname(bundleDir);
  return basename(versions).toLowerCase() === 'versions' ? dirname(versions) : null;
}

/** Loopback always; when LAN access is on, the LAN address and this computer's name too. */
function panelHosts(lanAddress: string | null): () => ReadonlySet<string> {
  const hosts = new Set<string>(LOOPBACK_HOSTS);
  if (lanAddress) {
    hosts.add(lanAddress);
    hosts.add(hostname().toLowerCase());
  }
  return () => hosts;
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
  mkdirSync(paths.backups, { recursive: true });
  // A restore requested from the panel happens here, before anything opens the database (FR-014).
  const restored = applyPendingRestore(paths.db, paths.backups);
  const db = openDatabase(paths.db, paths.backups);
  try {
    const m = migrate(db, undefined, {
      now: () => clock.now(),
      beforeMigrate: (from, to) => {
        const b = snapshotBefore(db, paths.backups, 'pre-migration', clock.now());
        logger.info({ from, to, file: b.file }, 'pre-migration backup created');
      },
    });
    if (m.applied.length > 0) logger.info({ from: m.from, to: m.to }, 'database migrated');
  } catch (e) {
    db.close();
    throw databaseError(paths.db, paths.backups, e);
  }

  // D2-14 / plan §9: a database a real hub has used is never opened in demo mode (the seed and
  // the forced dry-run would mix fake machines into real data and silence real wakes).
  const mode = db.get<{ value: string }>(
    "SELECT value FROM system_state WHERE key = 'data.mode'",
  )?.value;
  if (config.demo && mode === 'real') {
    db.close();
    await fileLogger?.close();
    throw new HubStartError(
      `the data folder ${config.dataDir} holds real data; demo mode cannot use it (choose another folder with --data-dir)`,
    );
  }
  if (!config.demo && mode !== 'real') {
    db.run(
      "INSERT INTO system_state (key, value) VALUES ('data.mode', 'real') ON CONFLICT(key) DO UPDATE SET value = 'real'",
    );
  }

  // Demo mode never constructs the real sender (AC-015-01): no packet can leave the machine, and
  // interfaces, probes and DNS are simulated too (FR-015, R-M3-03).
  const demoDevices = new SqliteDevicesRepo(db);
  const sim = config.demo
    ? new SimulatedNetwork({
        clock,
        wakeDelayMs: config.demoWakeDelayMs,
        devices: () => demoDevices.listCompact({}, Number.MAX_SAFE_INTEGER),
      })
    : null;
  const sender = sim ? sim.sender : new UdpPacketSender();
  const runner = new NodeProcessRunner();
  const icmpHelper =
    !sim && process.platform === 'win32' && opts.helperPath && !opts.ports
      ? new PsHelperIcmp(
          powershellSpawner(opts.helperPath),
          clock,
          logger.child({ module: 'probe-helper' }),
        )
      : null;
  const settingsConcurrency = () => services.settings.get('monitor.concurrency');
  const prober = new CompositeProber(
    new TcpProber(settingsConcurrency),
    icmpHelper,
    process.platform === 'win32' ? new PingExeIcmp(runner) : null,
    settingsConcurrency,
  );
  const services = createServices(
    db,
    clock,
    opts.ports ??
      (sim
        ? {
            interfaces: sim.interfaces,
            sender,
            dryRunSender: sim.sender,
            prober: sim.prober,
            dns: sim.dns,
            neighbors: sim.neighbors,
            logger,
          }
        : {
            interfaces: new OsNetworkInterfaces(runner),
            sender,
            dryRunSender: new RecordingPacketSender(),
            prober,
            dns: new OsDnsResolver(),
            neighbors:
              process.platform === 'win32'
                ? new WindowsNeighborCache(runner, opts.neighborScriptPath ?? null)
                : { read: () => Promise.resolve([]) },
            logger,
          }),
    {
      demo: config.demo,
      hostChecks: opts.hostChecks ?? null,
      timeCheck: opts.timeCheck ?? null,
      version: APP_VERSION,
      configFile: opts.ports ? null : new JsonConfigFile(paths.config),
      backupsDir: opts.ports ? null : paths.backups,
      requestRestart: () => opts.requestRestart?.(),
      prepareScript: new PrepareScriptFile(opts.prepareScriptPath ?? null),
      releaseSource: opts.releaseSource ?? null,
      oui: (() => {
        const file = new OuiFile(opts.ouiPath ?? null);
        return () => file.get();
      })(),
      install: opts.installDir
        ? {
            fs: new NodeFileSystem(),
            installDir: opts.installDir,
            dataDir: config.dataDir,
            panelPort: config.panelPort,
            schemaVersion: latestSchemaVersion(),
            launcher: opts.updateLauncher ?? null,
          }
        : null,
      running: {
        panelPort: config.panelPort,
        agentPort: config.agentPort,
        logLevel: config.logLevel,
      },
    },
  );

  // LAN access (FR-006.4, ADR-012): HTTPS only, on its own listener; loopback stays HTTP.
  const lanAddress =
    services.settings.get('panel.lanEnabled') && services.settings.get('panel.lanAddress') !== ''
      ? services.settings.get('panel.lanAddress')
      : null;
  if (restored?.failed) {
    services.audit.record({
      actor: { id: restored.byId, label: restored.by },
      action: 'backup.restore',
      target: `backup:${restored.file}`,
      result: 'error',
      details: { requestedAt: restored.at, reason: restored.failed },
    });
    services.notices.system('restore_failed', { file: restored.file, reason: restored.failed });
    logger.error(
      { file: restored.file, reason: restored.failed },
      'requested restore did not happen',
    );
  } else if (restored) {
    services.audit.record({
      actor: { id: restored.byId, label: restored.by },
      action: 'backup.restore',
      target: `backup:${restored.file}`,
      details: { requestedAt: restored.at },
    });
    logger.warn({ file: restored.file }, 'database restored from backup');
  }
  const certificates = new PanelCertificateStore(paths.certs, runner, opts.certScriptPath ?? null);
  services.panelCertificates = certificates;
  services.logs = new LogFileReader(paths.logs);
  const registerPanel = async (app: FastifyInstance) => {
    await registerPanelRoutes(app, services);
    if (opts.webDir) await registerStatic(app, opts.webDir);
  };
  let panel: FastifyInstance | undefined;
  let panelLan: FastifyInstance | null = null;
  let agent: FastifyInstance;
  try {
    panel = await buildApp({
      kind: 'panel',
      logger: logger.child({ listener: 'panel' }),
      hosts: panelHosts(lanAddress),
      register: registerPanel,
    });
    if (lanAddress) {
      try {
        const cert = await (opts.panelCertificate?.() ?? certificates.loadOrCreate(lanAddress));
        panelLan = await buildApp({
          kind: 'panel',
          logger: logger.child({ listener: 'panel-lan' }),
          hosts: panelHosts(lanAddress),
          https: cert,
          register: registerPanel,
        });
      } catch (e) {
        // The local panel must still open: report the problem there instead of not starting.
        const message = e instanceof Error ? e.message : String(e);
        logger.error({ err: e }, 'LAN panel access could not start');
        services.notices.system('lan_error', { message });
      }
    }
    agent = await buildApp({
      kind: 'agent',
      logger: logger.child({ listener: 'agent' }),
      hosts: 'any',
      bodyLimit: 8 * 1024,
      register: (app) => registerAgentRoutes(app, services),
    });
  } catch (e) {
    // R-M1-01: release what was opened so the DB file is not left locked.
    await panel?.close();
    await panelLan?.close();
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
      return {
        panel: fmt(panel),
        agent: fmt(agent),
        ...(panelLan ? { panelLan: fmt(panelLan) } : {}),
      };
    },
    async start() {
      try {
        await listen(panel, 'panel', config.panelBind, config.panelPort);
        if (panelLan && lanAddress) {
          try {
            await listen(panelLan, 'panel (LAN, HTTPS)', lanAddress, config.panelPort);
          } catch (e) {
            // M6-F1: a wrong LAN address must not take the local panel down with it.
            const message = e instanceof Error ? e.message : String(e);
            logger.error({ err: e }, 'LAN panel access could not start');
            services.notices.system('lan_error', { message });
            await panelLan.close();
            panelLan = null;
          }
        }
        await listen(agent, 'agent', config.agentBind, config.agentPort);
      } catch (e) {
        await hub.stop();
        throw e;
      }
      started = true;
      if (sim && config.demoSeed) {
        // A demo that cannot seed still starts (M4-F6): an empty panel beats a crash loop.
        let seeded: ReturnType<typeof seedDemo> = null;
        try {
          seeded = seedDemo({
            ...services,
            jobs: new SqliteJobsRepo(db),
            monitor: new SqliteMonitorRepo(db),
            transaction: (fn) => db.transaction(fn),
            setPower: (mac, on) => sim.setPower(mac, on),
            neverWakes: (mac) => SimulatedNetwork.neverWakes(mac),
            demo: new SqliteDemoRepo(db),
            runs: new SqliteSchedulerRepo(db),
          });
        } catch (e) {
          logger.error({ err: e }, 'demo seed failed');
        }
        if (seeded) logger.info({ ...seeded }, 'demo data seeded');
      }
      services.runner.recover();
      services.testWol.recover();
      services.scheduler.start();
      services.monitor.start();
      services.dashboard.start();
      services.retention.start();
      services.health.start();
      services.backups?.start();
      services.update.start();
      services.updates.start();
      await services.updates.recordOutcome(paths.updates);
      logger.info(
        { version: APP_VERSION, ...hub.addresses(), demo: config.demo },
        'UniWake hub started',
      );
    },
    async stop() {
      services.updates.stop();
      services.update.stop();
      services.scheduler.stop();
      services.health.stop();
      services.backups?.stop();
      services.testWol.stop();
      services.runner.stop();
      services.dashboard.stop();
      await services.retention.stop();
      await services.monitor.stop();
      await Promise.allSettled([panel.close(), agent.close(), panelLan?.close()]);
      await sender.close();
      icmpHelper?.close();
      db.close();
      if (started) logger.info({}, 'UniWake hub stopped');
      started = false;
      await fileLogger?.close();
    },
  };
  return hub;
}
