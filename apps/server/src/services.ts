/**
 * Builds application services over a database and ports. Used by the hub (real adapters) and by
 * API tests (fakes), so both run the same wiring.
 */
import { AuditService } from './application/audit/audit-service';
import { AuthService } from './application/auth/auth-service';
import { CsvImportService } from './application/devices/csv-import-service';
import { DevicesService } from './application/devices/devices-service';
import { EventsBus } from './application/events-bus';
import { MonitorService } from './application/monitor/monitor-service';
import { ProbeQueue } from './application/monitor/probe-queue';
import type {
  Clock,
  DnsResolver,
  Logger,
  NetworkInterfaces,
  PacketSender,
  Prober,
} from './application/ports';
import { KeyedLimiter } from './application/rate-limit';
import { RoomsService } from './application/rooms/rooms-service';
import { SettingsService } from './application/settings/settings-service';
import { TagsService } from './application/tags/tags-service';
import { JobRunner } from './application/wake/job-runner';
import { ProberVerifier } from './application/wake/verifier';
import { WakeService } from './application/wake/wake-service';
import type { Db } from './db/connection';
import { SqliteAuditRepo } from './db/repositories/audit-repo';
import { SqliteSessionsRepo, SqliteUsersRepo } from './db/repositories/auth-repos';
import { SqliteDevicesRepo } from './db/repositories/devices-repo';
import { SqliteJobsRepo } from './db/repositories/jobs-repo';
import { SqliteMonitorRepo } from './db/repositories/monitor-repo';
import { SqliteRoomsRepo } from './db/repositories/rooms-repo';
import { SqliteSettingsRepo } from './db/repositories/settings-repo';
import { SqliteTagsRepo } from './db/repositories/tags-repo';
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
}

export interface Services extends HttpServices {
  db: Db;
  clock: Clock;
  events: EventsBus;
  runner: JobRunner;
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
  const auth = new AuthService(
    new SqliteUsersRepo(db),
    new SqliteSessionsRepo(db),
    settings,
    audit,
    clock,
    tx,
  );
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
  });

  const runner = new JobRunner({
    jobs: jobsRepo,
    rooms: roomsRepo,
    settings,
    clock,
    interfaces: ports.interfaces,
    sender: ports.sender,
    dryRunSender: ports.dryRunSender,
    verifier: new ProberVerifier(probes.at('high'), ports.dns, settings),
    audit,
    events,
    logger: ports.logger.child({ module: 'wake' }),
    transaction: tx,
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
  };
}
