import type { FastifyInstance } from 'fastify';
import type { HttpServices } from '../context';

/** FR-001.2 update status (operator) and an immediate check (admin). */
export function updateRoutes(app: FastifyInstance, s: HttpServices): void {
  app.get('/api/update', { config: { auth: 'operator' } }, async () => s.update.status());
  app.post('/api/update/check', { config: { auth: 'admin' } }, async () => s.update.check());
}
