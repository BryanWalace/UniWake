/** All panel-listener routes (plan §6.1). Shared by the hub and API tests. */
import type { FastifyInstance } from 'fastify';
import type { HttpServices } from './context';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { deviceRoutes } from './routes/devices';
import { eventsRoutes } from './routes/events';
import { healthRoutes } from './routes/health';
import { roomRoutes } from './routes/rooms';
import { scheduleRoutes } from './routes/schedules';
import { settingsRoutes } from './routes/settings';
import { tagRoutes } from './routes/tags';
import { userRoutes } from './routes/users';
import { wakeRoutes } from './routes/wake';
import { registerSessionAuth } from './session-auth';

export async function registerPanelRoutes(app: FastifyInstance, s: HttpServices): Promise<void> {
  await registerSessionAuth(app, s.auth);
  healthRoutes(app);
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
}

/** Agent listener: exactly health, enrollment and the script download (ADR-011). */
export function registerAgentRoutes(app: FastifyInstance): void {
  healthRoutes(app);
  // M7-T02: POST /agent/enroll; M7-T01: GET /agent/prepare-target.ps1
}
