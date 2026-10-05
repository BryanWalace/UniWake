import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AuditRow,
  CreatedEnrollmentToken,
  DashboardNotice,
  Device,
  EnrollmentMoves,
  EnrollRequest,
  Page,
} from '@uniwake/shared';
import { cleanSmbios } from '../src/domain/smbios';
import { buildApp } from '../src/http/app';
import { registerAgentRoutes } from '../src/http/panel';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const HOUR = 3_600_000;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup() {
  const h: ApiHarness = await apiHarness(undefined, {
    prepareScript: { bytes: () => Buffer.from('script') },
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
  const lab2 = h.services.rooms.create({ name: 'Lab 2' }, ACTOR);
  const lab3 = h.services.rooms.create({ name: 'Lab 3' }, ACTOR);
  const token = async (roomId = lab3.id, extra: object = {}) =>
    (
      await h.inject({
        method: 'POST',
        url: '/api/enrollment/tokens',
        cookie,
        payload: { roomId, ...extra },
      })
    ).json<CreatedEnrollmentToken>();
  const enroll = (tok: string | null, body: Partial<EnrollRequest>, ip = '10.0.3.41') =>
    agent.inject({
      method: 'POST',
      url: '/agent/enroll',
      remoteAddress: ip,
      headers: {
        host: '10.0.3.15:47101',
        ...(tok !== null ? { authorization: `Bearer ${tok}` } : {}),
      },
      payload: {
        roomCode: 'LAB3',
        mac: '00-1A-2B-3C-4D-5E',
        hostname: 'LAB3-PC01',
        ip: '10.0.3.41',
        manufacturer: 'Dell Inc.',
        model: 'OptiPlex 7090',
        serial: 'ABC1234',
        os: 'Windows 11 Pro 23H2',
        otherMacs: ['00:1A:2B:3C:4D:5F'],
        prepareResults: { 'Fast Startup': 'OK', ICMP: 'OK' },
        ...body,
      },
    });
  const get = async <T>(url: string) => (await h.inject({ url, cookie })).json<T>();
  return { h, agent, cookie, lab2, lab3, token, enroll, get };
}

describe('POST /agent/enroll (FR-007.2)', () => {
  it('AC-007-05: a valid token for Lab 3 and a new MAC create the device in Lab 3, named after the host', async () => {
    const { h, lab3, token, enroll, get } = await setup();
    const t = await token();
    const r = await enroll(t.token, {});
    expect(r.statusCode).toBe(200);
    const body = r.json<{ result: string; deviceId: number; room: string; message: string }>();
    expect(body).toMatchObject({
      result: 'created',
      room: 'Lab 3',
      message: 'Computador cadastrado na sala Lab 3.',
    });
    const d = await get<Device>(`/api/devices/${body.deviceId}`);
    expect(d).toMatchObject({
      name: 'LAB3-PC01',
      mac: '00:1A:2B:3C:4D:5E',
      ip: '10.0.3.41',
      hostname: 'LAB3-PC01',
      roomId: lab3.id,
      manufacturer: 'Dell Inc.',
      model: 'OptiPlex 7090',
      serial: 'ABC1234',
      os: 'Windows 11 Pro 23H2',
      otherMacs: ['00:1A:2B:3C:4D:5F'],
      preparedAt: T0,
      enrolledAt: T0,
    });
    const row = h.services.db.get<{ prepare_results: string }>(
      'SELECT prepare_results FROM devices WHERE id = ?',
      [body.deviceId],
    );
    expect(JSON.parse(row!.prepare_results)).toEqual({ 'Fast Startup': 'OK', ICMP: 'OK' });
    expect((await get<CreatedEnrollmentToken[]>('/api/enrollment/tokens'))[0]!.uses).toBe(1);
    const audit = await get<Page<AuditRow>>('/api/audit?action=enrollment.enroll');
    expect(audit.items[0]).toMatchObject({
      actorLabel: 'cadastro (LAB3-PC01)',
      target: 'device:LAB3-PC01',
      result: 'ok',
      sourceIp: '10.0.3.41',
    });
    expect(JSON.stringify(audit)).not.toContain(t.token);
  });

  it('AC-007-06: an existing MAC in Lab 3 is updated, never duplicated, and keeps its name', async () => {
    const { h, lab3, token, enroll } = await setup();
    const existing = h.services.devices.create(
      {
        name: 'Mesa do professor',
        mac: '00:1A:2B:3C:4D:5E',
        roomId: lab3.id,
        notes: 'perto da porta',
      },
      ACTOR,
    ).device;
    const t = await token();
    const r = await enroll(t.token, { ip: '10.0.3.77' });
    expect(r.json()).toMatchObject({
      result: 'updated',
      deviceId: existing.id,
      message: 'Cadastro atualizado na sala Lab 3.',
    });
    const d = h.services.devices.get(existing.id);
    expect(d).toMatchObject({
      name: 'Mesa do professor',
      notes: 'perto da porta',
      ip: '10.0.3.77',
      hostname: 'LAB3-PC01',
    });
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(1);
    // A second run of the script is idempotent.
    expect((await enroll(t.token, { ip: '10.0.3.77' })).json()).toMatchObject({
      result: 'updated',
    });
    const events = h.services.db.all<{ type: string }>(
      'SELECT type FROM device_events WHERE device_id = ? ORDER BY id',
      [existing.id],
    );
    expect(events.map((e) => e.type)).toEqual(['ip_changed', 'enrolled', 'enrolled']);
  });

  it('AC-007-07: a MAC in Lab 2 moves to Lab 3, is audited and listed on the dashboard for 24 h', async () => {
    const { h, lab2, lab3, token, enroll, get } = await setup();
    const pc = h.services.devices.create(
      { name: 'PC-07', mac: '00:1A:2B:3C:4D:5E', roomId: lab2.id },
      ACTOR,
    ).device;
    const t = await token();
    const r = await enroll(t.token, {});
    expect(r.json()).toMatchObject({
      result: 'moved',
      deviceId: pc.id,
      room: 'Lab 3',
      message: 'Computador movido de Lab 2 para Lab 3.',
    });
    expect(h.services.devices.get(pc.id).roomId).toBe(lab3.id);
    const audit = await get<Page<AuditRow>>('/api/audit?action=enrollment.enroll');
    expect(audit.items[0]!.details).toMatchObject({
      result: 'moved',
      message: 'movida de Lab 2 para Lab 3',
    });
    const notices = await get<DashboardNotice[]>('/api/notices');
    const moves = notices.find((n) => n.type === 'enrollment_moves');
    expect((moves?.data as unknown as EnrollmentMoves).moves).toEqual([
      { deviceId: pc.id, deviceName: 'PC-07', from: 'Lab 2', to: 'Lab 3', at: T0 },
    ]);
    // A second move within 24 h joins the same notice; after 24 h a move is no longer listed.
    const other = h.services.devices.create(
      { name: 'PC-08', mac: '00:1A:2B:3C:4D:60', roomId: null },
      ACTOR,
    ).device;
    h.clock.advance(HOUR);
    await enroll(t.token, { mac: '00:1A:2B:3C:4D:60', hostname: 'LAB3-PC08' });
    let list = (await get<DashboardNotice[]>('/api/notices')).filter(
      (n) => n.type === 'enrollment_moves',
    );
    expect(list).toHaveLength(1);
    expect((list[0]!.data as unknown as EnrollmentMoves).moves.map((m) => m.from)).toEqual([
      'Lab 2',
      'Sem sala',
    ]);
    h.clock.advance(23.5 * HOUR);
    const c2 = await h.login('operator-user');
    list = (await h.inject({ url: '/api/notices', cookie: c2 })).json<DashboardNotice[]>();
    const left = list.find((n) => n.type === 'enrollment_moves');
    expect((left!.data as unknown as EnrollmentMoves).moves.map((m) => m.deviceId)).toEqual([
      other.id,
    ]);
    h.clock.advance(HOUR);
    list = (await h.inject({ url: '/api/notices', cookie: c2 })).json<DashboardNotice[]>();
    expect(list.find((n) => n.type === 'enrollment_moves')).toBeUndefined();
  });

  it('AC-007-08: expired, revoked, exhausted, unknown tokens and a wrong room code are refused', async () => {
    const { h, token, enroll, lab2, cookie } = await setup();
    const code = async (tok: string | null, body: Partial<EnrollRequest> = {}) => {
      const r = await enroll(tok, body);
      return { status: r.statusCode, code: r.json<{ code: string }>().code };
    };
    expect(await code(null)).toEqual({ status: 401, code: 'ENROLL_TOKEN_INVALID' });
    expect(await code('x'.repeat(32))).toEqual({ status: 401, code: 'ENROLL_TOKEN_INVALID' });
    const revoked = await token();
    await h.inject({
      method: 'POST',
      url: `/api/enrollment/tokens/${revoked.id}/revoke`,
      cookie,
      payload: {},
    });
    expect(await code(revoked.token)).toEqual({ status: 401, code: 'ENROLL_TOKEN_REVOKED' });
    const once = await token(undefined, { maxUses: 1 });
    expect((await enroll(once.token, {})).statusCode).toBe(200);
    expect(await code(once.token, { mac: '00:1A:2B:3C:4D:61' })).toEqual({
      status: 401,
      code: 'ENROLL_TOKEN_EXHAUSTED',
    });
    const otherRoom = await token(lab2.id);
    expect(await code(otherRoom.token)).toEqual({ status: 422, code: 'ENROLL_ROOM_MISMATCH' });
    const short = await token(undefined, { expiresHours: 1 });
    h.clock.advance(HOUR);
    expect(await code(short.token)).toEqual({ status: 401, code: 'ENROLL_TOKEN_EXPIRED' });
    // Refusals do not create devices or consume uses, and each is audited as denied.
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(1);
    const c2 = await h.login('operator-user');
    const denied = (
      await h.inject({ url: '/api/audit?action=enrollment.enroll&result=denied', cookie: c2 })
    ).json<Page<AuditRow>>();
    expect(denied.items.map((a) => (a.details as { reason: string }).reason).sort()).toEqual([
      'ENROLL_ROOM_MISMATCH',
      'ENROLL_TOKEN_EXHAUSTED',
      'ENROLL_TOKEN_EXPIRED',
      'ENROLL_TOKEN_INVALID',
      'ENROLL_TOKEN_REVOKED',
    ]);
  });

  it('AC-007-12: SMBIOS placeholders are stored as null', async () => {
    const { h, token, enroll } = await setup();
    const t = await token();
    const r = await enroll(t.token, {
      manufacturer: 'To be filled by O.E.M.',
      model: 'System Product Name',
      serial: 'To Be Filled By O.E.M.',
      os: '  ',
    });
    const d = h.services.devices.get(r.json<{ deviceId: number }>().deviceId);
    expect(d).toMatchObject({ manufacturer: null, model: null, serial: null, os: null });
  });

  it('cleans SMBIOS placeholders and filler text but keeps real values', () => {
    for (const junk of [
      'To be filled by O.E.M.',
      'Default string',
      'System Serial Number',
      'default STRING',
      '0000000000',
      'XXXXXXXX',
      '********',
      '',
      '\u0000',
      null,
      undefined,
    ]) {
      expect(cleanSmbios(junk), String(junk)).toBeNull();
    }
    expect(cleanSmbios(' Dell Inc. ')).toBe('Dell Inc.');
    expect(cleanSmbios('5CD1234XYZ')).toBe('5CD1234XYZ');
  });

  it('validates the body only after the token, ignores bad extra MACs and the primary MAC', async () => {
    const { h, token, enroll } = await setup();
    const t = await token();
    const bad = await enroll(t.token, { mac: 'zz' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    const ok = await enroll(t.token, {
      otherMacs: ['nope', '00:1a:2b:3c:4d:5e', '01:00:5E:00:00:01', '00-1A-2B-3C-4D-70'],
    });
    const d = h.services.devices.get(ok.json<{ deviceId: number }>().deviceId);
    expect(d.otherMacs).toEqual(['00:1A:2B:3C:4D:70']);
    // Long host names fit the device name limit.
    const long = await enroll(t.token, {
      mac: '00:1A:2B:3C:4D:71',
      hostname: `${'a'.repeat(60)}.${'b'.repeat(19)}`,
    });
    expect(h.services.devices.get(long.json<{ deviceId: number }>().deviceId).name).toHaveLength(
      64,
    );
  });

  it('limits each source IP to 10 requests a minute, before reading the token', async () => {
    const { h, token, enroll } = await setup();
    const t = await token();
    for (let i = 0; i < 10; i++) {
      expect((await enroll(null, {}, '10.0.3.99')).statusCode).toBe(401);
    }
    const limited = await enroll(t.token, {}, '10.0.3.99');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await enroll(t.token, {}, '10.0.3.98')).statusCode).toBe(200);
    h.clock.advance(60_000);
    expect((await enroll(t.token, {}, '10.0.3.99')).statusCode).toBe(200);
  });

  it('rejects bodies over 8 KB', async () => {
    const { token, enroll } = await setup();
    const t = await token();
    const r = await enroll(t.token, {
      prepareResults: { x: 'a'.repeat(250) },
      os: 'b'.repeat(9000),
    });
    expect(r.statusCode).toBe(413);
  });

  it('the agent listener has exactly three routes', async () => {
    const { agent } = await setup();
    expect(agent.routeTable.map((r) => `${r.method} ${r.url} ${r.auth}`).sort()).toEqual([
      'GET /agent/prepare-target.ps1 public',
      'GET /api/health public',
      'POST /agent/enroll enrollment',
    ]);
  });
});
