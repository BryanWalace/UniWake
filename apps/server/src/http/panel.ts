/** All panel-listener routes (plan §6.1). Shared by the hub and API tests. */
import type { FastifyInstance } from 'fastify';
import type { HttpServices } from './context';
import { authRoutes } from './routes/auth';
import { deviceRoutes } from './routes/devices';
import { healthRoutes } from './routes/health';
import { roomRoutes } from './routes/rooms';
import { tagRoutes } from './routes/tags';
import { registerSessionAuth } from './session-auth';

export async function registerPanelRoutes(app: FastifyInstance, s: HttpServices): Promise<void> {
  await registerSessionAuth(app, s.auth);
  healthRoutes(app);
  authRoutes(app, s);
  roomRoutes(app, s);
  tagRoutes(app, s);
  deviceRoutes(app, s);
}

/** Agent listener: exactly health, enrollment and the script download (ADR-011). */
export function registerAgentRoutes(app: FastifyInstance): void {
  healthRoutes(app);
  // M7-T02: POST /agent/enroll; M7-T01: GET /agent/prepare-target.ps1
}
