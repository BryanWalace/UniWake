/**
 * Builds application services over a database and ports. Used by the hub (real adapters) and by
 * API tests (fakes), so both run the same wiring.
 */
import type { WakeTarget } from '@uniwake/shared';
import { AuditService } from './application/audit/audit-service';
import { AuthService } from './application/auth/auth-service';
import { BackupService } from './application/backups/backup-service';
import { ExportService } from './application/migration/export-service';
import { ImportService } from './application/migration/import-service';
import { AutoExportService } from './application/migration/auto-export';
import { ShutdownReconciler } from './application/power/reconcile';
import { SelfDeviceService } from './application/power/self-device';
import { ShutdownDiagnosticsService } from './application/power/diagnostics';
import { ShutdownTestService } from './application/power/shutdown-test';
import { agentVersionOf, healthEvents, productFor } from './application/power/agent-health';
import { nodeExportFolder } from './adapters/export-folder';
import { SqliteMigrationStateRepo } from './db/repositories/migration-repo';
import { applyImport, hasPreparedMachines, previewImport } from './db/sync/import';
import { UsersService } from './application/auth/users-service';
import { CsvImportService } from './application/devices/csv-import-service';
import { DashboardService } from './application/dashboard/dashboard-service';
import {
  HealthService,
  type HostChecks,
  type TimeCheck,
} from './application/health/health-service';
import { NetworkPreviewService } from './application/network/network-preview';
import { NoticesService } from './application/notices/notices-service';
import { DevicesService } from './application/devices/devices-service';
import { DiagnosticsService } from './application/devices/diagnostics-service';
import { DiscoveryService, type NeighborCache } from './application/discovery/discovery-service';
import { EnrollmentService, type PrepareScript } from './application/enrollment/enrollment-service';
import { EventsBus } from './application/events-bus';
import { MonitorService } from './application/monitor/monitor-service';
import { RetentionService } from './application/maintenance/retention-service';
import { ObservingVerifier } from './application/monitor/observing-verifier';
import { ProbeQueue } from './application/monitor/probe-queue';
import type {
  Clock,
  DnsResolver,
  Logger,
  LogSource,
  NetworkInterfaces,
  PacketSender,
  FileSystem,
  Prober,
  ReleaseSource,
} from './application/ports';
import { KeyedLimiter } from './application/rate-limit';
import { RoomsService } from './application/rooms/rooms-service';
import { Scheduler } from './application/schedules/scheduler';
import { rowsToTarget, SchedulesService } from './application/schedules/schedules-service';
import {
  type BootstrapValues,
  type ConfigFileStore,
  SettingsAdminService,
} from './application/settings/settings-admin';
import { SettingsService } from './application/settings/settings-service';
import { TagsService } from './application/tags/tags-service';
import { TestWolService } from './application/test-wol/test-wol-service';
import { type UpdateLauncher, UpdateCoordinator } from './application/update/update-coordinator';
import { UpdateInstaller } from './application/update/update-installer';
import { UpdateService } from './application/update/update-service';
import { JobRunner } from './application/wake/job-runner';
import { ProberVerifier } from './application/wake/verifier';
import { WakeService } from './application/wake/wake-service';
import type { Db } from './db/connection';
import type { OuiTable } from './domain/oui';
import { DbBackupFiles, SqliteBackupsRepo } from './db/backups';
import { SqliteAuditRepo } from './db/repositories/audit-repo';
import { SqliteSessionsRepo, SqliteUsersRepo } from './db/repositories/auth-repos';
import { SqliteDashboardRepo } from './db/repositories/dashboard-repo';
import { SqliteDevicesRepo } from './db/repositories/devices-repo';
import { SqliteDiagnosticsRepo } from './db/repositories/diagnostics-repo';
import { SqliteEnrollmentRepo } from './db/repositories/enrollment-repo';
import { SqliteJobsRepo } from './db/repositories/jobs-repo';
import { SqliteMonitorRepo } from './db/repositories/monitor-repo';
import { SqliteNoticesRepo } from './db/repositories/notices-repo';
import { SqliteRetentionRepo } from './db/repositories/retention-repo';
import { SqliteRoomsRepo } from './db/repositories/rooms-repo';
import { SqliteSchedulerRepo } from './db/repositories/scheduler-repo';
import { SqliteSchedulesRepo } from './db/repositories/schedules-repo';
import { SqliteSettingsRepo } from './db/repositories/settings-repo';
import { SqliteTagsRepo } from './db/repositories/tags-repo';
import { SqliteTestWolRepo } from './db/repositories/test-wol-repo';
import { SqliteUpdateAutoSkip } from './db/repositories/update-skip-repo';
import { SqliteUpdateStateStore } from './db/repositories/update-state-repo';
import { hostname } from 'node:os';
import { exportCodec } from './adapters/export-codec';
import { DevSecretProtector } from './adapters/secret-protector';
import { NodeSyncNetwork } from './adapters/sync-network';
import { MissedRunsService } from './application/team/missed-runs';
import { PairingService } from './application/team/pairing';
import { SyncService } from './application/team/sync-service';
import { TeamLease } from './application/team/team-lease';
import { TeamService } from './application/team/team-service';
import type { SecretProtector, SyncEndpoint, SyncNetwork } from './application/ports';
import { SqliteTeamRepo } from './db/repositories/team-repo';
import { SqliteHubKeysRepo } from './db/repositories/hub-keys-repo';
import { HubKeyService } from './application/power/hub-key';
import { AgentTokensService } from './application/power/agent-tokens';
import { AgentService, type AgentScripts } from './application/power/agent-service';
import { SqliteDeviceAgentsRepo } from './db/repositories/device-agents-repo';
import {
  agentRows,
  deviceExtras,
  occurrenceOrders,
  pushedOccurrences,
  readAllHealth,
  readHealth,
  SqliteReconcileStore,
  SqliteDiagnosticsStore,
  SqliteShutdownTestsStore,
  occurrenceReports,
  recentPowerJobIds,
  SqlitePowerJobsRepo,
  SqlitePowerRepo,
} from './db/repositories/power-repo';
import { PowerStatusService } from './application/power/power-status';
import { PowerOrdersService } from './application/power/power-orders';
import { AgendaService } from './application/power/agenda-service';
import { scheduleRunUuid, uuidV5 } from './db/sync/uuid';
import { createHash, randomUUID } from 'node:crypto';
import { changesSince, SqliteReplicaStore } from './db/sync/apply';
import { changeLog, configureChangeLog } from './db/sync/change-log';
import type { HttpServices } from './http/context';

export interface ServicePorts {
  interfaces: NetworkInterfaces;
  /** Real UDP sender (never used when the job is a dry run). */
  sender: PacketSender;
  dryRunSender: PacketSender;
  prober: Prober;
  dns: DnsResolver;
  logger: Logger;
  /** IPv4 neighbor (ARP) cache for discovery (FR-101); absent = discovery finds nothing. */
  neighbors?: NeighborCache;
  /** Modo equipe sockets (FR-202); absent = loopback-only sockets (tests). */
  syncNetwork?: SyncNetwork;
  /** Team secrets at rest (ADR-037); absent = development protector (tests). */
  secrets?: SecretProtector;
}

export interface ServiceOptions {
  /** Demo mode: every wake is a dry run (constitution §2.5). */
  demo?: boolean;
  /** config.json for bootstrap settings (hub); absent in API tests = read-only. */
  configFile?: ConfigFileStore | null;
  /** Bootstrap values the process started with. */
  running?: BootstrapValues;
  /** Health checks that leave the process (hub on Windows / with network); absent in tests. */
  hostChecks?: HostChecks | null;
  timeCheck?: TimeCheck | null;
  version?: string;
  /** Where backups are written (hub: <dataDir>/backups); no backups without it. */
  backupsDir?: string | null;
  /** Restarts the service after a restore request (hub: exit code 75). */
  requestRestart?: () => void;
  /** Update source (ADR-025); absent or demo = no update checks (FR-001.2). */
  releaseSource?: ReleaseSource | null;
  /** Installing updates (FR-001.3): where this version is installed and the data lives. */
  install?: {
    fs: FileSystem;
    installDir: string;
    dataDir: string;
    panelPort: number;
    schemaVersion: number;
    /** Starts updater.mjs through scheduled tasks (hub on Windows). */
    launcher: UpdateLauncher | null;
  } | null;
  /** Bundled MAC vendor list (FR-101). */
  oui?: () => OuiTable;
  /** prepare-target.ps1 as served by the agent listener (FR-007.3); absent = not installed. */
  prepareScript?: PrepareScript;
  /** Lab-PC agent scripts (v1.3); absent = none (API tests that do not enroll agents). */
  agentScripts?: AgentScripts;
  /** Modo equipe (FR-201..204): team port and, in tests, where announcements go. */
  team?: {
    port: number;
    defaultPort: number;
    machineName?: string;
    announceTargets?: () => readonly SyncEndpoint[];
  };
}

export interface Services extends HttpServices {
  /** Present on an installed, non-demo hub with an update source (FR-001.3). */
  updateInstaller: UpdateInstaller | null;
  /** LAN panel certificate (hub only): admins upload a PFX in the settings. */
  panelCertificates?: { save(pfx: Buffer, passphrase: string): void };
  logs?: LogSource;
  db: Db;
  clock: Clock;
  events: EventsBus;
  runner: JobRunner;
  retention: RetentionService;
  scheduler: Scheduler;
  monitor: MonitorService;
  probes: ProbeQueue;
  /** Signs answers to lab PCs (v1.3, ADR-044); `init()` runs at hub start. */
  hubKey: HubKeyService;
  agentTokens: AgentTokensService;
  /** Lab PCs' shutdown agendas (FR-303.1). */
  agenda: AgendaService;
  /** v1.4 daily export to a folder (FR-405). */
  autoExport: AutoExportService;
}

export function createServices(
  db: Db,
  clock: Clock,
  ports: ServicePorts,
  opts: ServiceOptions = {},
): Services {
  const tx = <T>(fn: () => T): T => db.transaction(fn);
  // ADR-031: change-log times come from the hub clock (fake in tests).
  configureChangeLog(db, () => clock.now());
  const audit = new AuditService(new SqliteAuditRepo(db), clock);
  const settings = new SettingsService(new SqliteSettingsRepo(db), clock);
  const migrationState = new SqliteMigrationStateRepo(db);
  const usersRepo = new SqliteUsersRepo(db);
  const sessionsRepo = new SqliteSessionsRepo(db);
  const auth = new AuthService(usersRepo, sessionsRepo, settings, audit, clock, tx);
  const users = new UsersService({
    users: usersRepo,
    sessions: sessionsRepo,
    auth,
    audit,
    clock,
    transaction: tx,
  });
  const events = new EventsBus();

  const roomsRepo = new SqliteRoomsRepo(db);
  const tagsRepo = new SqliteTagsRepo(db);
  const devicesRepo = new SqliteDevicesRepo(db);
  const jobsRepo = new SqliteJobsRepo(db);

  const rooms = new RoomsService(roomsRepo, audit, clock, tx);
  const tags = new TagsService(tagsRepo, audit, tx);
  const devices = new DevicesService(devicesRepo, audit, clock, tx);
  const csv = new CsvImportService(devicesRepo, roomsRepo, tagsRepo, audit, clock, tx);

  // One probe pool: wake verification jumps ahead of monitoring sweeps (AC-004-13).
  const probes = new ProbeQueue(ports.prober, () => settings.get('monitor.concurrency'));
  const monitor = new MonitorService({
    repo: new SqliteMonitorRepo(db),
    ...(ports.neighbors ? { neighbors: ports.neighbors } : {}),
    prober: probes.at('low'),
    dns: ports.dns,
    settings,
    clock,
    events,
    logger: ports.logger.child({ module: 'monitor' }),
    transaction: tx,
    cancelProbes: () => void probes.cancelPending('low'),
  });

  const dashboard = new DashboardService({
    repo: new SqliteDashboardRepo(db),
    settings,
    clock,
    logger: ports.logger.child({ module: 'uptime' }),
    transaction: tx,
    demo: opts.demo === true,
    lastSweepAt: () => monitor.lastSweep?.startedAt ?? null,
    pause: () => scheduler.pauseState(),
    standby: () => {
      const s = migrationState.standby();
      return s ? { since: s.since, from: s.from } : null;
    },
    notices: () => notices.list(),
  });

  const runner = new JobRunner({
    jobs: jobsRepo,
    rooms: roomsRepo,
    settings,
    clock,
    interfaces: ports.interfaces,
    sender: ports.sender,
    dryRunSender: ports.dryRunSender,
    verifier: new ObservingVerifier(
      new ProberVerifier(probes.at('high'), ports.dns, settings),
      (ids) => monitor.recordAlive(ids),
    ),
    audit,
    events,
    logger: ports.logger.child({ module: 'wake' }),
    transaction: tx,
    onFinished: (job) => {
      notices.onJobFinished(job);
      testWol.onJobFinished(job);
    },
    auditTarget: (target: WakeTarget): string => wake.auditTarget(target),
  });
  const retention = new RetentionService({
    repo: new SqliteRetentionRepo(db),
    settings,
    clock,
    logger: ports.logger.child({ module: 'retention' }),
    busy: () => runner.activeCount > 0,
    yieldNow: () => new Promise((resolve) => setImmediate(resolve)),
  });
  const wake = new WakeService({
    snapshot: () =>
      devicesRepo.listCompact({}, Number.MAX_SAFE_INTEGER).map((d) => ({
        id: d.id,
        name: d.name,
        mac: d.mac,
        ip: d.ip,
        hostname: d.hostname,
        roomId: d.roomId,
        tagIds: d.tagIds,
        enabled: d.enabled,
        status: d.status,
      })),
    rooms: roomsRepo,
    tags: tagsRepo,
    jobs: jobsRepo,
    settings,
    audit,
    clock,
    runner,
    limiter: new KeyedLimiter(clock, 60_000, () => settings.get('wake.rateLimitPerMinute')),
    transaction: tx,
    forceDryRun: opts.demo === true,
  });

  const testWol = new TestWolService({
    repo: new SqliteTestWolRepo(db),
    device: (id) => devicesRepo.get(id),
    verifier: new ProberVerifier(probes.at('high'), ports.dns, settings),
    startWake: (deviceId, actor) =>
      wake.start(
        { target: { type: 'devices', deviceIds: [deviceId] }, onlyOffline: false },
        actor,
        { source: 'test', preConfirmed: true, assumeOffline: true },
      ).jobId,
    jobResult: (jobId, deviceId) =>
      jobsRepo.devices(jobId).find((x) => x.deviceId === deviceId)?.result,
    audit,
    clock,
    logger: ports.logger.child({ module: 'test-wol' }),
  });

  const diagnostics = new DiagnosticsService({
    repo: new SqliteDiagnosticsRepo(db),
    device: (id) => devicesRepo.get(id),
    roomBroadcast: (roomId) => roomsRepo.get(roomId)?.directedBroadcast ?? null,
    lastTestWol: (deviceId) => testWol.latestForDevice(deviceId),
    interfaces: ports.interfaces,
    settings,
  });

  const refs = {
    room: (id: number) => roomsRepo.get(id) !== undefined,
    tag: (id: number) => tagsRepo.get(id) !== undefined,
    device: (id: number) => devicesRepo.get(id) !== undefined,
  };
  const schedulesRepo = new SqliteSchedulesRepo(db);
  const schedules = new SchedulesService({
    repo: schedulesRepo,
    refs,
    describeTargets: (targets) => wake.describeTargets(targets),
    settings,
    audit,
    clock,
    transaction: tx,
    tagUuids: {
      toUuid: (id) => (tagsRepo.get(id) ? changeLog(db).uuidOf('tag', id) : null),
      toId: (uuid) =>
        db.get<{ id: number }>('SELECT id FROM tags WHERE uuid = ?', [uuid])?.id ?? null,
    },
  });

  const schedulerRepo = new SqliteSchedulerRepo(db);
  const notices = new NoticesService({
    repo: new SqliteNoticesRepo(db),
    runOf: (runId) => schedulerRepo.runInfo(runId),
    jobDevices: (jobId) => jobsRepo.devices(jobId),
    roomName: (roomId) => roomsRepo.get(roomId)?.name,
    settings,
    audit,
    clock,
    events,
    transaction: tx,
  });
  // ---------------------------------------------------------------- Modo equipe (v1.2)
  const replica = new SqliteReplicaStore(db);
  const protector = ports.secrets ?? new DevSecretProtector();
  const team = new TeamService({
    repo: new SqliteTeamRepo(db),
    protector,
    clock,
    audit,
    logger: ports.logger.child({ module: 'team' }),
    instanceId: () => changeLog(db).instanceId(),
    machineName: (opts.team?.machineName ?? hostname()).slice(0, 64),
  });
  const teamPort = opts.team?.port ?? 0;
  const sync = new SyncService({
    team,
    replica,
    network: ports.syncNetwork ?? new NodeSyncNetwork({ bind: '127.0.0.1' }),
    interfaces: ports.interfaces,
    settings,
    notices,
    events,
    audit,
    clock,
    logger: ports.logger.child({ module: 'sync' }),
    port: teamPort,
    defaultPort: opts.team?.defaultPort ?? 47102,
    ...(opts.team?.announceTargets ? { announceTargets: opts.team.announceTargets } : {}),
  });
  const pairing = new PairingService({
    team,
    network: ports.syncNetwork ?? sync.network(),
    replica,
    clock,
    audit,
    logger: ports.logger.child({ module: 'pairing' }),
    ensureListening: () => sync.ensureListening(),
    fetchTeamState: (to, grant, inviter) => sync.fetchWithGrant(to, grant, inviter),
    backupBeforeJoin: () => void backupsRef.current?.create('pre-join'),
    onTeamChanged: () => {
      void sync.start();
      events.publish({ type: 'sync' });
    },
    defaultPort: opts.team?.defaultPort ?? 47102,
  });
  sync.attachPairing(pairing);
  const lease = new TeamLease({
    inTeam: () => team.inTeam(),
    self: () => team.self().instanceId,
    online: (now) => sync.onlineMembers(now),
  });
  const backupsRef: { current: BackupService | null } = { current: null };

  // v1.6 (ADR-053): the scheduler pushes shutdowns through the manual-shutdown service built below.
  const latePower: { power?: PowerOrdersService } = {};
  const tagIdsByUuid = (uuids: readonly string[]) =>
    uuids.length === 0
      ? []
      : db
          .all<{ id: number }>(
            `SELECT id FROM tags WHERE uuid IN (${uuids.map(() => '?').join(',')})`,
            [...uuids],
          )
          .map((r) => r.id);
  const lateReconcile: { r?: ShutdownReconciler } = {};
  // v1.6 (FR-504.3): "Testar agendamento" one-offs, built with the power services below.
  const lateTests: { t?: ShutdownTestService } = {};
  const scheduler = new Scheduler({
    repo: schedulerRepo,
    reconcile: (now) => {
      lateTests.t?.tick(now);
      lateReconcile.r?.tick(now);
    },
    pushShutdown: (sched, plannedAt) => {
      if (!latePower.power || !sched.uuid) throw new Error('shutdown service not ready');
      const occurrence = scheduleRunUuid(sched.uuid, plannedAt);
      const pushed = latePower.power.startScheduled({
        occurrence,
        scheduleName: sched.name,
        target: rowsToTarget(sched.targets, refs),
        policy: {
          warningMinutes: sched.warningMinutes ?? settings.get('power.defaultWarningMinutes'),
          allowPostpone: sched.allowPostpone ?? settings.get('power.postponeMax') > 0,
          postponeMax: sched.postponeMax ?? settings.get('power.postponeMax'),
          postponeMinutes: sched.postponeMinutes ?? settings.get('power.postponeMinutes'),
        },
        excludeTagIds: tagIdsByUuid(sched.excludeTags ?? []),
        plannedAt,
        orderUuid: (deviceId) =>
          uuidV5(
            `power-order:${occurrence}:${changeLog(db).uuidOf('device', deviceId) ?? deviceId}`,
          ),
      });
      return { ...pushed, occurrence };
    },
    lease,
    teamMode: () => team.inTeam(),
    standby: () => migrationState.standby() !== null,
    onMissedRun: (r) => notices.missedRun(r),
    refs,
    startWake: (req, actor, opts) => wake.start(req, actor, opts),
    settings,
    audit,
    clock,
    events,
    logger: ports.logger.child({ module: 'scheduler' }),
    transaction: tx,
    onRunProblem: (r) => notices.onRunProblem(r),
  });

  const settingsAdmin = new SettingsAdminService({
    settings,
    audit,
    transaction: tx,
    configFile: opts.configFile ?? null,
    running: opts.running ?? {
      panelPort: 47100,
      agentPort: 47101,
      syncPort: 47102,
      logLevel: 'info',
    },
  });

  const backups = opts.backupsDir
    ? new BackupService({
        repo: new SqliteBackupsRepo(db),
        files: new DbBackupFiles(db, opts.backupsDir),
        settings,
        clock,
        audit,
        logger: ports.logger.child({ module: 'backup' }),
        requestRestart: opts.requestRestart ?? (() => undefined),
      })
    : null;
  backupsRef.current = backups;
  // Remote shutdown counts for the health page; the status service is built further down.
  const late: { powerStatus?: PowerStatusService; hubKey?: HubKeyService } = {};
  const health = new HealthService({
    lastAutoExport: () => migrationState.lastAutoExport(),
    powerCounts: () =>
      late.powerStatus?.counts() ?? { ready: 0, needs_preparation: 0, revoked: 0, lost: 0 },
    agentAlerts: () => late.powerStatus?.agentAlerts() ?? { blocked: [], outdated: [] },
    clock,
    logger: ports.logger.child({ module: 'health' }),
    version: opts.version ?? '0.0.0-dev',
    instanceId: () => changeLog(db).instanceId(),
    startedAt: clock.now(),
    dbOk: () => {
      try {
        db.get('SELECT 1 AS ok');
        return true;
      } catch {
        return false;
      }
    },
    dbSizeBytes: () => {
      const pages = db.pragma<number>('page_count');
      const size = db.pragma<number>('page_size');
      return typeof pages === 'number' && typeof size === 'number' ? pages * size : null;
    },
    lastBackupAt: () =>
      db.get<{ t: number | null }>('SELECT MAX(created_at) AS t FROM backups')?.t ?? null,
    schedulerLastTick: () => schedulerRepo.lastTick(),
    schedulerPaused: () => scheduler.pauseState() !== null,
    nextRun: () => schedules.nextRunOverall(),
    lastSweep: () => monitor.lastSweep,
    monitorIntervalMs: () => settings.get('monitor.intervalSeconds') * 1000,
    host: opts.hostChecks ?? null,
    time: opts.timeCheck ?? null,
  });
  const network = new NetworkPreviewService({
    interfaces: ports.interfaces,
    settings,
    rooms: roomsRepo,
  });

  const enrollment = new EnrollmentService({
    repo: new SqliteEnrollmentRepo(db),
    rooms: roomsRepo,
    interfaces: ports.interfaces,
    script: opts.prepareScript ?? { bytes: () => null },
    settings,
    audit,
    clock,
    transaction: tx,
    agentPort: opts.running?.agentPort ?? 47101,
    onMoved: (move) => notices.onDeviceMoved(move),
    onPossibleDuplicate: (d) => notices.possibleDuplicate(d),
    hubKeyId: () => {
      try {
        return late.hubKey?.keyId() ?? null;
      } catch {
        return null; // not loaded yet
      }
    },
  });

  const update = new UpdateService({
    source: opts.demo ? null : (opts.releaseSource ?? null),
    version: opts.version ?? '0.0.0-dev',
    store: new SqliteUpdateStateStore(db),
    settings,
    clock,
    logger: ports.logger.child({ module: 'update' }),
  });

  const install = opts.install;
  const updateInstaller =
    install && opts.releaseSource && !opts.demo
      ? new UpdateInstaller({
          fs: install.fs,
          source: opts.releaseSource,
          pending: () => update.pending(),
          backup: () => backups?.create('pre-update') ?? null,
          audit,
          notice: (message) => notices.system('update_failed', { message }),
          clock,
          logger: ports.logger.child({ module: 'update' }),
          paths: { dataDir: install.dataDir, installDir: install.installDir },
          version: opts.version ?? '0.0.0-dev',
          panelPort: install.panelPort,
          schemaVersion: install.schemaVersion,
          dbSizeBytes: () => {
            const pages = db.pragma<number>('page_count');
            const size = db.pragma<number>('page_size');
            return typeof pages === 'number' && typeof size === 'number' ? pages * size : 0;
          },
        })
      : null;

  const updates = new UpdateCoordinator({
    update,
    installer: updateInstaller,
    launcher: install?.launcher ?? null,
    fs: install?.fs ?? null,
    settings,
    audit,
    clock,
    logger: ports.logger.child({ module: 'update' }),
    notice: (type, data) => notices.system(type, data),
    activeJobs: () => runner.activeCount,
    nextScheduledRunAt: () => schedules.nextRunOverall()?.at ?? null,
    autoSkip: new SqliteUpdateAutoSkip(db),
  });

  const discovery = new DiscoveryService({
    prober: probes.at('low'),
    neighbors: ports.neighbors ?? { read: () => Promise.resolve([]) },
    dns: ports.dns,
    interfaces: ports.interfaces,
    oui: opts.oui ?? (() => new Map()),
    findByMac: (mac) => devicesRepo.findByMac(mac),
    roomName: (id) => roomsRepo.get(id)?.name,
    createDevice: (d, actor) => {
      devices.create(
        { name: d.name, mac: d.mac, ip: d.ip, hostname: d.hostname, roomId: d.roomId },
        actor,
      );
    },
    transaction: tx,
    settings,
    audit,
    clock,
    logger: ports.logger.child({ module: 'discovery' }),
  });

  const hubKey = new HubKeyService({
    repo: new SqliteHubKeysRepo(db),
    protector,
    clock,
    logger: ports.logger.child({ module: 'hub-key' }),
  });
  late.hubKey = hubKey;
  const agentTokens = new AgentTokensService({
    repo: new SqliteDeviceAgentsRepo(db),
    audit,
    clock,
    transaction: tx,
  });
  const powerRepo = new SqlitePowerRepo(db);
  const agenda = new AgendaService({
    schedules: () => schedulesRepo.list(),
    exceptions: () => schedulesRepo.exceptions(),
    pause: () => schedulerRepo.pause(),
    device: (id) => powerRepo.agendaDevice(id),
    refs,
    dataVersion: () => powerRepo.dataVersion(),
    occurrenceId: scheduleRunUuid,
    digest: (t) => createHash('sha256').update(t).digest('hex'),
    oneOffs: (id) => lateTests.t?.oneOffs(id) ?? [],
    logger: ports.logger.child({ module: 'agenda' }),
    clock,
  });
  const power = (latePower.power = new PowerOrdersService({
    store: new SqlitePowerJobsRepo(db),
    resolve: (target) => wake.resolveForPower(target),
    settings,
    audit,
    events,
    clock,
    transaction: tx,
    newUuid: () => randomUUID(),
  }));
  const powerStatus = new PowerStatusService({
    agents: (ids) => agentRows(db, ids),
    occurrenceReports: (since) => occurrenceReports(db, since),
    deviceExtras: (ids) => deviceExtras(db, ids),
    pushedOccurrences: (since) => pushedOccurrences(db, since),
    occurrenceOrders: (occ) => occurrenceOrders(db, occ),
    tests: (since) => lateTests.t?.forHistory(since) ?? [],
    schedules: () => schedulesRepo.list(),
    refs,
    resolve: (target) => wake.resolveForPower(target),
    occurrenceId: scheduleRunUuid,
    recentJobIds: (limit) => recentPowerJobIds(db, limit),
    health: (id) => readHealth(db, id),
    healthAll: () => readAllHealth(db),
    latestAgentVersion: () => latestAgentVersion(),
    orders: power,
    clock,
  });
  late.powerStatus = powerStatus;
  lateReconcile.r = new ShutdownReconciler({
    store: new SqliteReconcileStore(db),
    schedule: (id) => schedulesRepo.list().find((x) => x.id === id),
    status: powerStatus,
    power,
    jobIdByUuid: (uuid) =>
      db.get<{ id: number }>('SELECT id FROM power_jobs WHERE uuid = ?', [uuid])?.id ?? null,
    occurrenceId: scheduleRunUuid,
    orderUuid: (occurrence, deviceId, suffix) =>
      uuidV5(
        `power-order:${occurrence}:${changeLog(db).uuidOf('device', deviceId) ?? deviceId}:${suffix}`,
      ),
    clock,
    logger: ports.logger.child({ module: 'reconcile' }),
  });
  const shutdownTests = (lateTests.t = new ShutdownTestService({
    store: new SqliteShutdownTestsStore(db),
    device: (id) => {
      const r = db.get<{ name: string; never: number }>(
        'SELECT name, never_scheduled_shutdown AS never FROM devices WHERE id = ?',
        [id],
      );
      return r && { name: r.name, neverScheduledShutdown: r.never === 1 };
    },
    readiness: (id) => powerStatus.device(id).readiness,
    agenda,
    power,
    status: powerStatus,
    jobIdByUuid: (uuid) =>
      db.get<{ id: number }>('SELECT id FROM power_jobs WHERE uuid = ?', [uuid])?.id ?? null,
    orderUuid: (occurrence, deviceId, suffix) =>
      uuidV5(
        `power-order:${occurrence}:${changeLog(db).uuidOf('device', deviceId) ?? deviceId}` +
          (suffix ? `:${suffix}` : ''),
      ),
    newUuid: () => randomUUID(),
    settings,
    audit,
    standby: () => migrationState.standby() !== null,
    transaction: tx,
    clock,
    logger: ports.logger.child({ module: 'power-test' }),
  }));
  const deviceNameOf = (id: number) =>
    db.get<{ name: string }>('SELECT name FROM devices WHERE id = ?', [id])?.name ?? String(id);
  // The agent version this hub ships, read once from the bundled script (FR-603.5).
  let shipped: { v: string | null } | null = null;
  const latestAgentVersion = () =>
    (shipped ??= { v: agentVersionOf(opts.agentScripts?.get('uniwake-agent.ps1')?.bytes) }).v;
  const agentPort = opts.running?.agentPort ?? 47101;
  const agent = new AgentService({
    tokens: agentTokens,
    hubKey,
    scripts: opts.agentScripts ?? { get: () => null },
    store: powerRepo,
    agenda,
    settings,
    clock,
    transaction: tx,
    hub: (host) => {
      // The address the machine used reaches this hub; otherwise the one chosen for enrollment.
      const fromHost =
        host && /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(host) ? `http://${host}` : null;
      const chosen = settings.get('enrollment.hubAddress');
      const self = changeLog(db).instanceId();
      // ADR-048: the team's hubs (their agent listener on the default port) with their keys.
      team.publishSigningKey(hubKey.keyId(), hubKey.publicKey());
      const peers = team.inTeam()
        ? team.members().flatMap((m) => {
            if (m.instanceId === self || m.revokedAt !== null) return [];
            if (!m.signingKeyId || !m.signingPublicJwk) return [];
            const p = team.peer(m.instanceId);
            const address = p?.manualAddress ?? p?.address ?? null;
            if (!address || !/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return [];
            return [
              {
                instanceId: m.instanceId,
                url: `http://${address}:47101`,
                keyId: m.signingKeyId,
                publicKey: JSON.parse(m.signingPublicJwk) as { n: string; e: string },
              },
            ];
          })
        : [];
      return {
        instanceId: self,
        epoch: team.epoch() ?? 0,
        selfUrl: fromHost ?? (chosen ? `http://${chosen}:${agentPort}` : null),
        peers,
      };
    },
    cancelId: (orderUuid) => uuidV5(`power-cancel:${orderUuid}`),
    version: opts.version ?? '0.0.0-dev',
    logger: ports.logger.child({ module: 'agent' }),
    // v1.6.0 (FR-604.2): what changed in a machine's health becomes one dashboard notice.
    onHealth: (deviceId, before, now, at) => {
      const events = healthEvents(before, now);
      if (events.length === 0) return;
      const stored = readHealth(db, deviceId);
      const deviceName = deviceNameOf(deviceId);
      notices.agentBlocked(
        events.map((e) => ({ ...e, deviceId, deviceName, product: productFor(stored, e.kind) })),
        at,
      );
    },
    onAlert: (deviceId, a) =>
      notices.agentBlocked(
        [
          {
            kind: 'agent_missing',
            file: a.file,
            at: a.at,
            deviceId,
            deviceName: deviceNameOf(deviceId),
            product: productFor(readHealth(db, deviceId), 'agent_missing'),
          },
        ],
        clock.now(),
      ),
  });

  const exporter = new ExportService({
    changes: () => changesSince(db, 0).entries,
    hubKey: async () => hubKey.exportKey(),
    self: () => team.self(),
    codec: exportCodec,
    settings,
    audit,
    clock,
    version: opts.version ?? '0.0.0-dev',
  });

  const autoExport = new AutoExportService({
    exporter,
    settings,
    clock,
    folder: nodeExportFolder,
    state: migrationState,
    self: () => team.self(),
    logger: ports.logger.child({ module: 'auto-export' }),
  });
  const importer = new ImportService({
    codec: exportCodec,
    store: {
      preview: (entries, replace) => previewImport(db, entries, { replace, now: clock.now() }),
      apply: (entries, replace, after) =>
        applyImport(db, entries, { replace, now: clock.now() }, after),
      hasPreparedMachines: () => hasPreparedMachines(db),
    },
    state: migrationState,
    inTeam: () => team.inTeam(),
    hubKey,
    backups,
    audit,
    clock,
    logger: ports.logger.child({ module: 'import' }),
    newId: () => randomUUID(),
  });

  return {
    db,
    clock,
    hubKey,
    exporter,
    importer,
    autoExport,
    shutdownDiagnostics: new ShutdownDiagnosticsService({
      agenda,
      store: new SqliteDiagnosticsStore(db),
      tests: shutdownTests,
      clock,
    }),
    shutdownTests,
    selfDevice: new SelfDeviceService({
      interfaces: ports.interfaces,
      devicesMatching: (macs, ips) =>
        db
          .all<{ id: number }>(
            'SELECT id FROM devices WHERE upper(mac) IN (SELECT value FROM json_each(?)) OR ip IN (SELECT value FROM json_each(?))',
            [JSON.stringify(macs), JSON.stringify(ips)],
          )
          .map((r) => r.id),
    }),
    agentTokens,
    agent,
    agenda,
    power,
    powerStatus,
    audit,
    settings,
    auth,
    rooms,
    tags,
    devices,
    csv,
    wake,
    events,
    runner,
    monitor,
    probes,
    dashboard,
    retention,
    schedules,
    scheduler,
    notices,
    users,
    settingsAdmin,
    network,
    health,
    backups,
    enrollment,
    testWol,
    diagnostics,
    update,
    updateInstaller,
    updates,
    discovery,
    team,
    pairing,
    sync,
    missedRuns: new MissedRunsService({
      notices,
      schedules,
      startWake: (req, actor, o) => wake.start(req, actor, o),
    }),
  };
}
