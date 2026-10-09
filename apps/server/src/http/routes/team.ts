import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  idParamSchema,
  teamJoinSchema,
  teamMemberParamSchema,
  teamMemberUpdateSchema,
  type TeamStatus,
} from '@uniwake/shared';
import type { HttpServices } from '../context';
import { actorOf } from '../session-auth';

/** Modo equipe (FR-201..204, plan §14). Pairing, revocation and leaving are admin actions. */
export function teamRoutes(app: FastifyInstance, s: HttpServices): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { auth: 'admin' } as const;
  const operator = { auth: 'operator' } as const;

  const status = async (): Promise<TeamStatus> => ({
    ...s.sync.status(),
    pairing: s.pairing.view(),
    addresses: await s.sync.localAddresses(),
    port: s.sync.ports().tcp ?? s.sync.defaultPort(),
  });

  r.get('/api/team', { config: admin }, status);

  r.post('/api/team/pairing', { config: admin }, async (req) => {
    await s.pairing.openCode(actorOf(req));
    void s.sync.announce();
    return status();
  });

  r.delete('/api/team/pairing', { config: admin }, async (_req, reply) => {
    s.pairing.cancel();
    return reply.status(204).send();
  });

  r.get('/api/team/discovered', { config: admin }, async () => {
    await s.sync.ensureUdp();
    return s.sync.discoveredPairing();
  });

  r.post('/api/team/join', { config: admin, schema: { body: teamJoinSchema } }, async (req) => {
    await s.pairing.join(req.body, actorOf(req));
    return status();
  });

  r.post('/api/team/sync', { config: admin }, async () => {
    await s.sync.syncAll(true);
    return status();
  });

  r.patch(
    '/api/team/members/:instanceId',
    { config: admin, schema: { params: teamMemberParamSchema, body: teamMemberUpdateSchema } },
    async (req) => {
      const actor = actorOf(req);
      if (req.body.name !== undefined) s.team.rename(req.params.instanceId, req.body.name, actor);
      if (req.body.address !== undefined) {
        s.team.setAddress(req.params.instanceId, req.body.address, actor);
      }
      return status();
    },
  );

  r.post(
    '/api/team/members/:instanceId/revoke',
    { config: admin, schema: { params: teamMemberParamSchema } },
    async (req) => {
      await s.team.revoke(req.params.instanceId, actorOf(req));
      await s.sync.pushRekey();
      return status();
    },
  );

  r.post('/api/team/leave', { config: admin }, async (req) => {
    s.team.leave(actorOf(req));
    s.sync.stop();
    return status();
  });

  r.get('/api/team/conflicts', { config: admin }, async () => s.team.conflicts(200));

  // FR-204.2: "Ligar agora" on a missed-run notice.
  r.post(
    '/api/notices/:id/wake-missed',
    { config: operator, schema: { params: idParamSchema } },
    async (req) => s.missedRuns.wakeNow(req.params.id, actorOf(req)),
  );
}
