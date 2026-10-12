/**
 * M17-T01 (FR-301.1, FR-302.2, ADR-043/044): agent tokens, their rotation and revocation, and the
 * signed agent part of the enrollment answer for v1.3 preparation scripts.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatedEnrollmentToken, EnrollAgentAnswer, EnrollResponse } from '@uniwake/shared';
import { tokenHash } from '../src/application/power/agent-tokens';
import { jwkThumbprint, verifySigned } from '../src/application/power/hub-key';
import { buildApp } from '../src/http/app';
import { registerAgentRoutes } from '../src/http/panel';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const DAY = 86_400_000;
const NONCE = 'q5KX2nX0v4m8Zk1d0b7S9w';
const SCRIPTS = {
  'uniwake-agent.ps1': Buffer.from('# agente'),
  'uniwake-aviso.ps1': Buffer.from('# aviso'),
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

type EnrollAnswer = EnrollResponse & { agent?: EnrollAgentAnswer; agentUnavailable?: string };

async function setup(scripts: Partial<typeof SCRIPTS> = SCRIPTS) {
  const h: ApiHarness = await apiHarness(undefined, {
    prepareScript: { bytes: () => Buffer.from('script') },
    agentScripts: {
      get: (name) => {
        const bytes = scripts[name];
        return bytes ? { bytes, sha256: tokenHash(bytes.toString()) } : null;
      },
    },
  });
  const agent: FastifyInstance = await buildApp({
    kind: 'agent',
    hosts: 'any',
    bodyLimit: 8 * 1024,
    register: (a) => registerAgentRoutes(a, h.services),
  });
  cleanups.push(async () => {
    await agent.close();
    await h.close();
  });
  const cookie = await h.as('operator');
  const room = h.services.rooms.create({ name: 'Lab 3' }, ACTOR);
  const tok = (
    await h.inject({
      method: 'POST',
      url: '/api/enrollment/tokens',
      cookie,
      payload: { roomId: room.id },
    })
  ).json<CreatedEnrollmentToken>().token;
  const enroll = (extra: object = {}) =>
    agent.inject({
      method: 'POST',
      url: '/agent/enroll',
      remoteAddress: '10.0.3.41',
      headers: { host: '10.0.3.15:47101', authorization: `Bearer ${tok}` },
      payload: { roomCode: 'LAB3', mac: '00-1A-2B-3C-4D-5E', hostname: 'LAB3-PC01', ...extra },
    });
  return { h, enroll };
}

describe('agent part of the enrollment answer (FR-301.1, ADR-044)', () => {
  it('a v1.3 script gets its token, the hub key and script hashes, signed over its nonce', async () => {
    const { h, enroll } = await setup();
    const r = await enroll({ agent: { protocol: 1, nonce: NONCE } });
    expect(r.statusCode).toBe(200);
    const body = r.json<EnrollAnswer>();
    expect(body.result).toBe('created');
    const a = body.agent!;
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.keyId).toBe(jwkThumbprint(a.hubKey));
    expect(a.keyId).toBe(h.services.hubKey.keyId());
    expect(a.scripts['uniwake-agent.ps1'].sha256).toBe(tokenHash('# agente'));
    expect(r.headers['x-uniwake-key']).toBe(a.keyId);
    const sig = String(r.headers['x-uniwake-signature']);
    expect(verifySigned(a.hubKey, NONCE, r.rawPayload, sig)).toBe(true);
    expect(verifySigned(a.hubKey, 'outro-nonce-aaaaaaaaaa', r.rawPayload, sig)).toBe(false);
    // Only the hash is kept.
    const stored = h.services.db.get<{ token_hash: string }>(
      'SELECT token_hash FROM device_agents',
    );
    expect(stored!.token_hash).toBe(tokenHash(a.token));
    expect(JSON.stringify(h.services.db.all('SELECT * FROM device_agents'))).not.toContain(a.token);
  });

  it('scripts before v1.3 get the same answer as before, unsigned and without a token', async () => {
    const { h, enroll } = await setup();
    const r = await enroll();
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json<object>()).sort()).toEqual(['deviceId', 'message', 'result', 'room']);
    expect(r.headers['x-uniwake-signature']).toBeUndefined();
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM device_agents')!.n).toBe(0);
  });

  it('an unknown agent protocol or a hub without the scripts still enrolls, without a token', async () => {
    const { enroll } = await setup();
    const odd = (await enroll({ agent: { protocol: 9, nonce: NONCE } })).json<EnrollAnswer>();
    expect(odd.result).toBe('created');
    expect(odd.agent).toBeUndefined();
    expect(odd.agentUnavailable).toMatch(/não suportada/);

    const missing = await setup({ 'uniwake-agent.ps1': SCRIPTS['uniwake-agent.ps1'] });
    const r = await missing.enroll({ agent: { protocol: 1, nonce: NONCE } });
    expect(r.json<EnrollAnswer>().agentUnavailable).toMatch(/Arquivos do agente ausentes/);
    expect(
      missing.h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM device_agents')!.n,
    ).toBe(0);
  });
});

describe('the copied command pins the hub key (FR-301.1, ADR-044)', () => {
  it('carries -HubKeyId with this hub key id', async () => {
    const h = await apiHarness(undefined, {
      prepareScript: { bytes: () => Buffer.from('script') },
    });
    cleanups.push(() => h.close());
    const cookie = await h.as('operator');
    const room = h.services.rooms.create({ name: 'Lab 3' }, ACTOR);
    const tok = (
      await h.inject({
        method: 'POST',
        url: '/api/enrollment/tokens',
        cookie,
        payload: { roomId: room.id },
      })
    ).json<CreatedEnrollmentToken>().token;
    const r = await h.inject({
      method: 'POST',
      url: '/api/enrollment/command',
      cookie,
      payload: { token: tok, address: '10.0.3.15' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ command: string }>().command).toContain(
      `-HubKeyId '${h.services.hubKey.keyId()}' } }`,
    );
  });
});

describe('agent tokens (FR-302.2, ADR-043)', () => {
  async function enrolled() {
    const s = await setup();
    const a = (await s.enroll({ agent: { protocol: 1, nonce: NONCE } })).json<EnrollAnswer>();
    return { ...s, token: a.agent!.token, deviceId: a.deviceId, tokens: s.h.services.agentTokens };
  }

  it('AC-302-02: a revoked, unknown or replaced token identifies no machine', async () => {
    const { h, enroll, token, tokens, deviceId } = await enrolled();
    expect(tokens.authenticate(token)?.deviceId).toBe(deviceId);
    expect(tokens.authenticate('x'.repeat(43))).toBeNull();
    // Preparing again issues a new token; the old one stops working.
    const again = (await enroll({ agent: { protocol: 1, nonce: NONCE } })).json<EnrollAnswer>();
    expect(tokens.authenticate(token)).toBeNull();
    expect(tokens.authenticate(again.agent!.token)?.deviceId).toBe(deviceId);
    tokens.revoke(deviceId, 'LAB3-PC01', ACTOR);
    expect(tokens.authenticate(again.agent!.token)).toBeNull();
    expect(h.services.audit.query({ action: 'agent.revoke' }).total).toBe(1);
  });

  it('AC-302-04: after 30 days a new token is due; both work until the new one is used', async () => {
    const { h, token, tokens, deviceId } = await enrolled();
    const row = () => h.services.agentTokens.authenticate(token)?.row;
    expect(tokens.rotationDue(row()!)).toBe(false);
    h.clock.set(h.clock.now() + 30 * DAY);
    expect(tokens.rotationDue(row()!)).toBe(true);
    const fresh = tokens.rotate(deviceId);
    expect(tokens.authenticate(token)?.deviceId).toBe(deviceId); // old still works
    expect(tokens.authenticate(fresh)?.deviceId).toBe(deviceId); // using the new one…
    expect(tokens.authenticate(token)).toBeNull(); // …retires the old one
    expect(tokens.rotationDue(tokens.authenticate(fresh)!.row)).toBe(false);
  });

  it('a machine frozen without a persistent area is never rotated (it would lock itself out)', async () => {
    const { h, token, tokens } = await enrolled();
    h.clock.set(h.clock.now() + 40 * DAY);
    const frozen = { ...tokens.authenticate(token)!.row, freezeState: 'frozen' as const };
    expect(tokens.rotationDue({ ...frozen, persistent: false })).toBe(false);
    expect(tokens.rotationDue({ ...frozen, persistent: true })).toBe(true);
    expect(tokens.rotationDue({ ...frozen, freezeState: 'thawed', persistent: false })).toBe(true);
  });
});
