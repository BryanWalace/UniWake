/**
 * Builds application services over a database and ports. Used by the hub (real adapters) and by
 * API tests (fakes), so both run the same wiring.
 */
import type { WakeTarget } from '@uniwake/shared';
import { AuditService } from './application/audit/audit-service';
import { AuthService } from './application/auth/auth-service';
import { BackupService } from './application/backups/backup-service';
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
  Prober,
} from './application/ports';
import { KeyedLimiter } from './application/rate-limit';
import { RoomsService } from './application/rooms/rooms-service';
import { Scheduler } from './application/schedules/scheduler';
import { SchedulesService } from './application/schedules/schedules-service';
import {
  type BootstrapValues,
  type ConfigFileStore,
  SettingsAdminService,
} from './application/settings/settings-admin';
import { SettingsService } from './application/settings/settings-service';
import { TagsService } from './application/tags/tags-service';
import { TestWolService } from './application/test-wol/test-wol-service';
import { JobRunner } from './application/wake/job-runner';
import { ProberVerifier } from './application/wake/verifier';
import { WakeService } from './application/wake/wake-service';
import type { Db } from './db/connection';
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
import type { HttpServices } from './http/context';

export interface ServicePorts {
  interfaces: NetworkInterfaces;
  /** Real UDP sender (never used when the job is a dry run). */
  sender: PacketSender;
  dryRunSender: PacketSender;
  prober: Prober;
  dns: DnsResolver;
  logger: Logger;
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
  /** prepare-target.ps1 as served by the agent listener (FR-007.3); absent = not installed. */
  prepareScript?: PrepareScript;
}

export interface Services extends HttpServices {
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
}

export function createServices(
  db: Db,
  clock: Clock,
  ports: ServicePorts,
  opts: ServiceOptions = {},
): Services {
  const tx = <T>(fn: () => T): T => db.transaction(fn);
  const audit = new AuditService(new SqliteAuditRepo(db), clock);
  const settings = new SettingsService(new SqliteSettingsRepo(db), clock);
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
  const schedules = new SchedulesService({
    repo: new SqliteSchedulesRepo(db),
    refs,
    describeTargets: (targets) => wake.describeTargets(targets),
    settings,
    audit,
    clock,
    transaction: tx,
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
  const scheduler = new Scheduler({
    repo: schedulerRepo,
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
    running: opts.running ?? { panelPort: 47100, agentPort: 47101, logLevel: 'info' },
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
  const health = new HealthService({
    clock,
    logger: ports.logger.child({ module: 'health' }),
    version: opts.version ?? '0.0.0-dev',
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
  });

  return {
    db,
    clock,
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
  };
}
