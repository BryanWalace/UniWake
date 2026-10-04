import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  deviceBulkSchema,
  deviceCreateSchema,
  deviceListQuerySchema,
  deviceUpdateSchema,
  idParamSchema,
} from '@uniwake/shared';
import { csvImportSchema } from '../../application/devices/csv-import-service';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-002.1 devices (plan §6.1). */
export function deviceRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.get(
    '/api/devices',
    { config: auth, schema: { querystring: deviceListQuerySchema } },
    async (req) => s.devices.list(req.query),
  );

  r.post(
    '/api/devices',
    { config: auth, schema: { body: deviceCreateSchema } },
    async (req, reply) => reply.status(201).send(s.devices.create(req.body, actorOf(req))),
  );

  // FR-002.3 CSV import (preview never writes) and export.
  const csvRoute = {
    config: auth,
    bodyLimit: 3.5 * 1024 * 1024,
    schema: { body: csvImportSchema },
  };
  r.post('/api/devices/import/preview', csvRoute, async (req) => s.csv.preview(req.body));
  r.post('/api/devices/import/commit', csvRoute, async (req) =>
    s.csv.commit(req.body, actorOf(req)),
  );
  r.get('/api/devices/export.csv', { config: auth }, async (_req, reply) => {
    // R-M2-02: the operator's local date, not UTC.
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: s.settings.get('scheduler.timezone'),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="uniwake-dispositivos-${day}.csv"`)
      .send(s.csv.exportCsv());
  });

  r.post('/api/devices/bulk', { config: auth, schema: { body: deviceBulkSchema } }, async (req) =>
    s.devices.bulk(req.body, actorOf(req)),
  );

  r.get('/api/devices/:id', { config: auth, schema: { params: idParamSchema } }, async (req) =>
    s.devices.get(req.params.id),
  );

  r.patch(
    '/api/devices/:id',
    { config: auth, schema: { params: idParamSchema, body: deviceUpdateSchema } },
    async (req) => s.devices.update(req.params.id, req.body, actorOf(req)),
  );

  r.delete(
    '/api/devices/:id',
    { config: auth, schema: { params: idParamSchema } },
    async (req, reply) => {
      s.devices.delete(req.params.id, actorOf(req));
      return reply.status(204).send();
    },
  );
}
