import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { auditQuerySchema } from '@uniwake/shared';
import { AuditService } from '../../application/audit/audit-service';
import { auditToCsv } from '../../domain/csv';
import type { HttpServices } from '../context';

/** FR-006.5 audit viewer and export (operators may view, per the FR-006.2 matrix). */
export function auditRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.get('/api/audit', { config: auth, schema: { querystring: auditQuerySchema } }, async (req) => {
    const { page, pageSize, ...filters } = req.query;
    const { items, total } = s.audit.query({
      ...AuditService.toQuery(filters),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items, total, page, pageSize };
  });

  r.get(
    '/api/audit/export.csv',
    { config: auth, schema: { querystring: auditQuerySchema } },
    async (req, reply) => {
      const { page: _p, pageSize: _s, ...filters } = req.query;
      const tz = s.settings.get('scheduler.timezone');
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="uniwake-auditoria-${day}.csv"`)
        .send(auditToCsv(s.audit.exportRows(AuditService.toQuery(filters)), tz));
    },
  );
}
