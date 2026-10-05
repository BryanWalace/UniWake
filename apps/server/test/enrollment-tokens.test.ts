import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AuditRow,
  CreatedEnrollmentToken,
  EnrollmentAddresses,
  EnrollmentCommand,
  EnrollmentToken,
  Page,
} from '@uniwake/shared';
import { buildCommand } from '../src/application/enrollment/enrollment-service';
import { buildApp } from '../src/http/app';
import { registerAgentRoutes } from '../src/http/panel';
import { iface } from './fakes/network-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const SCRIPT = Buffer.from('﻿param([string]$HubUrl)\r\nWrite-Host "ok"\r\n', 'utf8');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const HOUR = 3_600_000;

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

async function setup(script: Buffer | null = SCRIPT) {
  const h = await apiHarness(undefined, { prepareScript: { bytes: () => script } });
  hs.push(h);
  const cookie = await h.as('operator');
  const room = h.services.rooms.create({ name: 'Lab 3' }, ACTOR);
  const post = <T>(url: string, payload: object) =>
    h.inject({ method: 'POST', url, cookie, payload }).then((r) => ({
      status: r.statusCode,
      body: r.json<T>(),
    }));
  const get = async <T>(url: string) => (await h.inject({ url, cookie })).json<T>();
  const create = async (extra: object = {}) =>
    (await post<CreatedEnrollmentToken>('/api/enrollment/tokens', { roomId: room.id, ...extra }))
      .body;
  return { h, cookie, room, post, get, create };
}

describe('enrollment tokens (FR-007.3)', () => {
  it('AC-007-09: the value is shown once and only its hash is stored', async () => {
    const { h, post, room, get } = await setup();
    const r = await post<CreatedEnrollmentToken>('/api/enrollment/tokens', { roomId: room.id });
    expect(r.status).toBe(201);
    const t = r.body;
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(t).toMatchObject({
      roomId: room.id,
      roomName: 'Lab 3',
      roomCode: 'LAB3',
      createdBy: 'operator-user',
      expiresAt: T0 + 8 * HOUR, // enrollment.tokenExpiryHours
      maxUses: 100, // enrollment.tokenMaxUses
      uses: 0,
      state: 'ativo',
    });
    const rows = h.services.db.all<Record<string, unknown>>('SELECT * FROM enrollment_tokens');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(sha(t.token));
    expect(JSON.stringify(rows)).not.toContain(t.token);
    const listed = await get<EnrollmentToken[]>('/api/enrollment/tokens');
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('token');
    const audit = await get<Page<AuditRow>>('/api/audit?action=enrollment.');
    expect(audit.items[0]).toMatchObject({
      action: 'enrollment.token_create',
      target: 'room:Lab 3',
    });
    expect(JSON.stringify(audit)).not.toContain(t.token);
  });

  it('honours expiry and use limits from the request and reports each state', async () => {
    const { h, create, get, post, room } = await setup();
    const short = await create({ expiresHours: 1, maxUses: 2 });
    expect(short).toMatchObject({ expiresAt: T0 + HOUR, maxUses: 2 });
    const exhausted = await create();
    h.services.db.run('UPDATE enrollment_tokens SET uses = max_uses WHERE id = ?', [exhausted.id]);
    h.clock.advance(HOUR);
    const states = Object.fromEntries(
      (await get<EnrollmentToken[]>('/api/enrollment/tokens')).map((t) => [t.id, t.state]),
    );
    expect(states).toEqual({ [short.id]: 'expirado', [exhausted.id]: 'esgotado' });
    const missing = await post('/api/enrollment/tokens', { roomId: room.id + 99 });
    expect(missing.status).toBe(404);
    const bad = await post('/api/enrollment/tokens', { roomId: room.id, maxUses: 0 });
    expect(bad.status).toBe(422);
  });

  it('revokes once (audited) and is idempotent', async () => {
    const { create, post, get } = await setup();
    const t = await create();
    const r1 = await post<EnrollmentToken>(`/api/enrollment/tokens/${t.id}/revoke`, {});
    expect(r1.body).toMatchObject({ id: t.id, state: 'revogado', revokedAt: T0 });
    const r2 = await post<EnrollmentToken>(`/api/enrollment/tokens/${t.id}/revoke`, {});
    expect(r2.body.state).toBe('revogado');
    const audit = await get<Page<AuditRow>>('/api/audit?action=enrollment.token_revoke');
    expect(audit.total).toBe(1);
    expect((await post(`/api/enrollment/tokens/999/revoke`, {})).status).toBe(404);
  });

  it('lists ended tokens for 30 days, active ones always', async () => {
    const { h, create } = await setup();
    const old = await create({ expiresHours: 1 });
    const lasting = await create({ expiresHours: 168 });
    h.clock.advance(31 * 24 * HOUR);
    const cookie = await h.login('operator-user');
    const listed = (await h.inject({ url: '/api/enrollment/tokens', cookie })).json<
      EnrollmentToken[]
    >();
    expect(listed.map((t) => t.id)).not.toContain(old.id);
    expect(listed.map((t) => t.id)).not.toContain(lasting.id); // expired after 7 days
    h.services.db.run('UPDATE enrollment_tokens SET expires_at = ? WHERE id = ?', [
      h.clock.now() + HOUR,
      lasting.id,
    ]);
    const again = (await h.inject({ url: '/api/enrollment/tokens', cookie })).json<
      EnrollmentToken[]
    >();
    expect(again.map((t) => t.id)).toEqual([lasting.id]);
  });
});

describe('hub addresses and the one-line command (FR-007.3, ADR-011)', () => {
  it('offers usable addresses, prefers the remembered one, else the default-gateway one', async () => {
    const { h, get, post, create } = await setup();
    h.ports.interfaces.interfaces = [
      iface({ name: 'Wi-Fi', address: '192.168.0.5' }),
      iface({ name: 'Ethernet', address: '10.0.3.15', gateway: '10.0.3.1' }),
      iface({ name: 'APIPA', address: '169.254.10.1' }),
      iface({ name: 'Loopback', address: '127.0.0.1', internal: true }),
    ];
    const a = await get<EnrollmentAddresses>('/api/enrollment/addresses');
    expect(a.addresses).toEqual([
      { address: '192.168.0.5', interfaceName: 'Wi-Fi', hasGateway: false },
      { address: '10.0.3.15', interfaceName: 'Ethernet', hasGateway: true },
    ]);
    expect(a.selected).toBe('10.0.3.15');
    expect(a.agentPort).toBe(47101);
    // Choosing another address for a command remembers it.
    const t = await create();
    await post('/api/enrollment/command', { token: t.token, address: '192.168.0.5' });
    expect((await get<EnrollmentAddresses>('/api/enrollment/addresses')).selected).toBe(
      '192.168.0.5',
    );
    // A remembered address that is gone falls back to the default-gateway interface.
    h.ports.interfaces.interfaces = h.ports.interfaces.interfaces.slice(1);
    expect((await get<EnrollmentAddresses>('/api/enrollment/addresses')).selected).toBe(
      '10.0.3.15',
    );
    h.ports.interfaces.interfaces = [];
    expect(await get<EnrollmentAddresses>('/api/enrollment/addresses')).toMatchObject({
      addresses: [],
      selected: null,
    });
  });

  it('AC-007-13: the hash in the command equals the SHA-256 of the bytes the agent listener serves', async () => {
    const { h, post, create, get } = await setup();
    const t = await create();
    const r = await post<EnrollmentCommand>('/api/enrollment/command', {
      token: t.token,
      address: '10.0.3.15',
    });
    expect(r.status).toBe(200);
    const agent = await buildApp({
      kind: 'agent',
      hosts: 'any',
      register: (a) => registerAgentRoutes(a, h.services),
    });
    try {
      const served = await agent.inject({
        url: '/agent/prepare-target.ps1',
        headers: { host: '10.0.3.15:47101' },
      });
      expect(served.statusCode).toBe(200);
      expect(served.headers['cache-control']).toBe('no-store');
      expect(served.rawPayload.equals(SCRIPT)).toBe(true);
      expect(r.body.sha256).toBe(sha(served.rawPayload));
    } finally {
      await agent.close();
    }
    expect(r.body).toMatchObject({
      hubUrl: 'http://10.0.3.15:47101',
      scriptUrl: 'http://10.0.3.15:47101/agent/prepare-target.ps1',
      roomCode: 'LAB3',
    });
    const c = r.body.command;
    expect(c).not.toContain('\n');
    expect(c).toContain(`-Uri 'http://10.0.3.15:47101/agent/prepare-target.ps1'`);
    expect(c).toContain(`-ne '${r.body.sha256.toUpperCase()}'`);
    expect(c).toContain(`-HubUrl 'http://10.0.3.15:47101' -RoomCode 'LAB3' -Token '${t.token}'`);
    expect(c).toContain('Arquivo alterado — não execute');
    // The hash check comes before the script runs.
    expect(c.indexOf('Get-FileHash')).toBeLessThan(c.indexOf('-File $f'));
    const audit = await get<Page<AuditRow>>('/api/audit?action=enrollment.command');
    expect(audit.items[0]).toMatchObject({ target: 'room:Lab 3' });
    expect(JSON.stringify(audit)).not.toContain(t.token);
  });

  it('refuses commands for unknown, revoked, expired or exhausted tokens', async () => {
    const { h, post, create } = await setup();
    const cmd = (token: string) =>
      post<{ code: string }>('/api/enrollment/command', { token, address: '10.0.3.15' });
    expect((await cmd('x'.repeat(32))).body.code).toBe('ENROLL_TOKEN_INVALID');
    expect((await cmd('bad token!')).status).toBe(422);
    const revoked = await create();
    await post(`/api/enrollment/tokens/${revoked.id}/revoke`, {});
    expect((await cmd(revoked.token)).body.code).toBe('ENROLL_TOKEN_REVOKED');
    const used = await create();
    h.services.db.run('UPDATE enrollment_tokens SET uses = max_uses WHERE id = ?', [used.id]);
    expect((await cmd(used.token)).body.code).toBe('ENROLL_TOKEN_EXHAUSTED');
    const short = await create({ expiresHours: 1 });
    h.clock.advance(HOUR);
    expect((await cmd(short.token)).body.code).toBe('ENROLL_TOKEN_EXPIRED');
  });

  it('reports a missing script instead of producing a command that cannot be checked', async () => {
    const { h, post, create } = await setup(null);
    const t = await create();
    const r = await post<{ code: string }>('/api/enrollment/command', {
      token: t.token,
      address: '10.0.3.15',
    });
    expect(r).toMatchObject({ status: 503, body: { code: 'PREPARE_SCRIPT_MISSING' } });
    const agent = await buildApp({
      kind: 'agent',
      hosts: 'any',
      register: (a) => registerAgentRoutes(a, h.services),
    });
    try {
      const served = await agent.inject({ url: '/agent/prepare-target.ps1' });
      expect(served.statusCode).toBe(503);
    } finally {
      await agent.close();
    }
  });

  it('never builds a command from values that would need quoting', () => {
    const ok = {
      scriptUrl: 'http://10.0.3.15:47101/agent/prepare-target.ps1',
      hubUrl: 'http://10.0.3.15:47101',
      sha256: 'ab'.repeat(32),
      roomCode: 'LAB3',
      token: 'abc_DEF-123',
    };
    expect(() => buildCommand(ok)).not.toThrow();
    expect(() => buildCommand({ ...ok, roomCode: "LAB3'; rm" })).toThrow(/unsafe/);
    expect(() => buildCommand({ ...ok, token: 'a b' })).toThrow(/unsafe/);
  });
});
