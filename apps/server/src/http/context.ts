/**
 * Services the HTTP layer may call (plan §3: http → application only). Built by the composition
 * root and passed to route modules.
 */
import type { AuditService } from '../application/audit/audit-service';
import type { AuthService } from '../application/auth/auth-service';
import type { RoomsService } from '../application/rooms/rooms-service';
import type { SettingsService } from '../application/settings/settings-service';
import type { TagsService } from '../application/tags/tags-service';

export interface HttpServices {
  auth: AuthService;
  audit: AuditService;
  settings: SettingsService;
  rooms: RoomsService;
  tags: TagsService;
}
