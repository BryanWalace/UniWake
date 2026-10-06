/** All panel-listener routes (plan §6.1). Shared by the hub and API tests. */
import type { FastifyInstance } from 'fastify';
import type { HttpServices } from './context';
import { enrollRoute, prepareScriptRoute } from './routes/agent';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backups';
import { dashboardRoutes } from './routes/dashboard';
import { deviceRoutes } from './routes/devices';
import { discoveryRoutes } from './routes/discovery';
import { enrollmentRoutes } from './routes/enrollment';
import { eventsRoutes } from './routes/events';
import { healthDetailRoutes, healthRoutes } from './routes/health';
import { logRoutes } from './routes/logs';
import { roomRoutes } from './routes/rooms';
import { scheduleRoutes } from './routes/schedules';
import { settingsRoutes } from './routes/settings';
import { tagRoutes } from './routes/tags';
import { testWolRoutes } from './routes/test-wol';
import { updateRoutes } from './routes/update';
import { userRoutes } from './routes/users';
import { wakeRoutes } from './routes/wake';
import { registerSessionAuth } from './session-auth';

export async function registerPanelRoutes(app: FastifyInstance, s: HttpServices): Promise<void> {
  await registerSessionAuth(app, s.auth);
  healthRoutes(app, () => s.health.status());
  healthDetailRoutes(app, s);
  authRoutes(app, s);
  roomRoutes(app, s);
  tagRoutes(app, s);
  deviceRoutes(app, s);
  wakeRoutes(app, s);
  eventsRoutes(app, s);
  dashboardRoutes(app, s);
  scheduleRoutes(app, s);
  userRoutes(app, s);
  auditRoutes(app, s);
  settingsRoutes(app, s);
  logRoutes(app, s);
  backupRoutes(app, s);
  enrollmentRoutes(app, s);
  testWolRoutes(app, s);
  updateRoutes(app, s);
  discoveryRoutes(app, s);
}

/** Agent listener: exactly health, enrollment and the script download (ADR-011). */
export function registerAgentRoutes(
  app: FastifyInstance,
  s: Pick<HttpServices, 'enrollment'>,
): void {
  healthRoutes(app);
  prepareScriptRoute(app, s);
  enrollRoute(app, s);
}
