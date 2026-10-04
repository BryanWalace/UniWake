import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParamSchema, wakeRequestSchema } from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** FR-003.3 wake actions, FR-009 job progress, FR-003.6 packet log (plan §6.1). */
export function wakeRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { auth: 'operator' } as const;

  r.post('/api/wake/preview', { config: auth, schema: { body: wakeRequestSchema } }, async (req) =>
    s.wake.preview(req.body),
  );

  r.post('/api/wake', { config: auth, schema: { body: wakeRequestSchema } }, async (req, reply) =>
    reply.status(202).send(s.wake.start(req.body, actorOf(req))),
  );

  r.get(
    '/api/jobs',
    {
      config: auth,
      schema: {
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { items, total } = s.wake.jobs(
        req.query.pageSize,
        (req.query.page - 1) * req.query.pageSize,
      );
      return {
        items: items.map(
          ({ target: _t, stagger: _s, excludedCount: _e, scheduleRunId: _r, ...job }) => job,
        ),
        total,
        page: req.query.page,
        pageSize: req.query.pageSize,
      };
    },
  );

  r.get('/api/jobs/:id', { config: auth, schema: { params: idParamSchema } }, async (req) => {
    const { job, devices } = s.wake.job(req.params.id);
    const { target: _t, stagger: _s, excludedCount: _e, scheduleRunId: _r, ...rest } = job;
    return {
      job: rest,
      devices: devices.map(({ ip: _ip, hostname: _h, ...d }) => d),
    };
  });

  r.get('/api/jobs/:id/packets', { config: auth, schema: { params: idParamSchema } }, async (req) =>
    s.wake.packets(req.params.id),
  );
}
