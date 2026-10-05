import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { HttpServices } from '../context';

const logQuerySchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

/** FR-016 log viewer (admin only): last 5 MB of the current file, and the file itself. */
export function logRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { auth: 'admin' } as const;

  r.get('/api/logs', { config: admin, schema: { querystring: logQuerySchema } }, async (req) =>
    s.logs ? s.logs.read(req.query) : { entries: [], truncated: false, size: 0 },
  );

  r.get('/api/logs/download', { config: admin }, async (_req, reply) => {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: s.settings.get('scheduler.timezone'),
    }).format(new Date());
    reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="uniwake-log-${day}.log"`);
    return reply.send(s.logs?.open() ?? '');
  });
}
