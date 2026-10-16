/**
 * Services the HTTP layer may call (plan §3: http → application only). Built by the composition
 * root and passed to route modules.
 */
import type { MissedRunsService } from '../application/team/missed-runs';
import type { PairingService } from '../application/team/pairing';
import type { SyncService } from '../application/team/sync-service';
import type { TeamService } from '../application/team/team-service';
import type { AuditService } from '../application/audit/audit-service';
import type { AuthService } from '../application/auth/auth-service';
import type { UsersService } from '../application/auth/users-service';
import type { DashboardService } from '../application/dashboard/dashboard-service';
import type { CsvImportService } from '../application/devices/csv-import-service';
import type { DevicesService } from '../application/devices/devices-service';
import type { DiagnosticsService } from '../application/devices/diagnostics-service';
import type { DiscoveryService } from '../application/discovery/discovery-service';
import type { EnrollmentService } from '../application/enrollment/enrollment-service';
import type { EventsBus } from '../application/events-bus';
import type { Clock } from '../application/ports';
import type { BackupService } from '../application/backups/backup-service';
import type { ExportService } from '../application/migration/export-service';
import type { SelfDeviceService } from '../application/power/self-device';
import type { ShutdownDiagnosticsService } from '../application/power/diagnostics';
import type { ShutdownTestService } from '../application/power/shutdown-test';
import type { ImportService } from '../application/migration/import-service';
import type { HealthService } from '../application/health/health-service';
import type { NetworkPreviewService } from '../application/network/network-preview';
import type { LogSource } from '../application/ports';
import type { NoticesService } from '../application/notices/notices-service';
import type { RoomsService } from '../application/rooms/rooms-service';
import type { Scheduler } from '../application/schedules/scheduler';
import type { SchedulesService } from '../application/schedules/schedules-service';
import type { SettingsAdminService } from '../application/settings/settings-admin';
import type { SettingsService } from '../application/settings/settings-service';
import type { TagsService } from '../application/tags/tags-service';
import type { TestWolService } from '../application/test-wol/test-wol-service';
import type { UpdateCoordinator } from '../application/update/update-coordinator';
import type { UpdateService } from '../application/update/update-service';
import type { WakeService } from '../application/wake/wake-service';
import type { AgentService } from '../application/power/agent-service';
import type { HubKeyService } from '../application/power/hub-key';
import type { PowerOrdersService } from '../application/power/power-orders';
import type { PowerStatusService } from '../application/power/power-status';
import type { AgentTokensService } from '../application/power/agent-tokens';

export interface HttpServices {
  auth: AuthService;
  audit: AuditService;
  settings: SettingsService;
  rooms: RoomsService;
  tags: TagsService;
  devices: DevicesService;
  csv: CsvImportService;
  wake: WakeService;
  events: EventsBus;
  clock: Clock;
  dashboard: DashboardService;
  schedules: SchedulesService;
  scheduler: Scheduler;
  notices: NoticesService;
  users: UsersService;
  settingsAdmin: SettingsAdminService;
  network: NetworkPreviewService;
  health: HealthService;
  enrollment: EnrollmentService;
  testWol: TestWolService;
  diagnostics: DiagnosticsService;
  update: UpdateService;
  updates: UpdateCoordinator;
  discovery: DiscoveryService;
  /** Modo equipe (FR-201..204). */
  team: TeamService;
  pairing: PairingService;
  sync: SyncService;
  missedRuns: MissedRunsService;
  /** v1.3 lab-PC agent (FR-301..303) and the key that signs its answers (ADR-044). */
  agent: AgentService;
  hubKey: HubKeyService;
  /** Manual "Desligar" / "Reiniciar" (FR-305). */
  power: PowerOrdersService;
  /** Readiness, agent details and shutdown history (FR-307, FR-309). */
  powerStatus: PowerStatusService;
  agentTokens: AgentTokensService;
  /** null when the hub has no backups directory (API tests). */
  backups: BackupService | null;
  /** v1.4 "Backup e migração" (spec §6c). */
  exporter: ExportService;
  /** v1.6 (FR-501.5): inventory devices that are this PC. */
  selfDevice: SelfDeviceService;
  /** v1.6 (FR-502, FR-504.1): why a machine will (not) shut down on a schedule. */
  shutdownDiagnostics: ShutdownDiagnosticsService;
  /** v1.6 (FR-504.3): "Testar agendamento". */
  shutdownTests: ShutdownTestService;
  importer: ImportService;
  /** Hub only: the log viewer source (FR-016). */
  logs?: LogSource;
  /** Present on the hub: stores an uploaded PFX for LAN HTTPS (ADR-012). */
  panelCertificates?: { save(pfx: Buffer, passphrase: string): void };
}
