/**
 * Services the HTTP layer may call (plan §3: http → application only). Built by the composition
 * root and passed to route modules.
 */
import type { AuditService } from '../application/audit/audit-service';
import type { AuthService } from '../application/auth/auth-service';
import type { DashboardService } from '../application/dashboard/dashboard-service';
import type { CsvImportService } from '../application/devices/csv-import-service';
import type { DevicesService } from '../application/devices/devices-service';
import type { EventsBus } from '../application/events-bus';
import type { Clock } from '../application/ports';
import type { RoomsService } from '../application/rooms/rooms-service';
import type { SettingsService } from '../application/settings/settings-service';
import type { TagsService } from '../application/tags/tags-service';
import type { WakeService } from '../application/wake/wake-service';

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
}
