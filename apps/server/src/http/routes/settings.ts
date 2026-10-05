import type { FastifyInstance } from 'fastify';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-016 settings (admin only, FR-006.2). The body is validated by the shared settings schema. */
export function settingsRoutes(app: FastifyInstance, s: HttpServices): void {
  const admin = { auth: 'admin' } as const;

  app.get('/api/settings', { config: admin }, async () => s.settingsAdmin.view());

  app.patch('/api/settings', { config: admin }, async (req) =>
    s.settingsAdmin.save(req.body, actorOf(req)),
  );
}
