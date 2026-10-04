/**
 * Services the HTTP layer may call (plan §3: http → application only). Built by the composition
 * root and passed to route modules.
 */
import type { AuditService } from '../application/audit/audit-service';
import type { AuthService } from '../application/auth/auth-service';
import type { SettingsService } from '../application/settings/settings-service';

export interface HttpServices {
  auth: AuthService;
  audit: AuditService;
  settings: SettingsService;
}
