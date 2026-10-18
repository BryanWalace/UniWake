/**
 * M17-T02 (FR-302, ADR-043/044): the lab PCs' check-in — authentication, limits, reports, orders,
 * agenda, hub list and the signature over the machine's nonce.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AgentReport,
  checkinAnswerSchema,
  type CheckinAnswer,
  type CheckinRequest,
  type CreatedEnrollmentToken,
  type EnrollAgentAnswer,
  type EnrollResponse,
  WAS_OFF_ORDER_DETAIL,
} from '@uniwake/shared';
import { tokenHash } from '../src/application/power/agent-tokens';
import { verifySigned } from '../src/application/power/hub-key';
import { buildApp } from '../src/http/app';
import { registerAgentRoutes } from '../src/http/panel';
import { changeLog } from '../src/db/sync/change-log';
import { apiHarness, type ApiHarness } from './helpers/api';
import { relogPower } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const DAY = 86_400_000;
const NONCE = 'q5KX2nX0v4m8Zk1d0b7S9w';
const sp = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h + 3, m);
const uuid = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup() {
  const h: ApiHarness = await apiHarness(undefined, {
    prepareScript: { bytes: () => Buffer.from('script') },
    agentScripts: {
      get: (name) => ({ bytes: Buffer.from(`# ${name}`), sha256: tokenHash(`# ${name}`) }),
    },
  });
  h.clock.set(sp(12, 12)); // Monday noon
  const agent: FastifyInstance = await buildApp({
    kind: 'agent',
    hosts: 'any',
    bodyLimit: 8 * 1024, // as on the hub; the check-in route allows 64 KB
    register: (a) => registerAgentRoutes(a, h.services),
  });
  cleanups.push(async () => {
    await agent.close();
    relogPower(h.services.db); // orders set up with raw SQL (ADR-048 logging)
    await h.close();
  });
  const cookie = await h.as('operator');
  const s = h.services;
  const room = s.rooms.create({ name: 'Lab 3' }, ACTOR);
  const tok = (
    await h.inject({
      method: 'POST',
      url: '/api/enrollment/tokens',
      cookie,
      payload: { roomId: room.id },
    })
  ).json<CreatedEnrollmentToken>().token;
  const enrolled = (
    await agent.inject({
      method: 'POST',
      url: '/agent/enroll',
      remoteAddress: '10.0.3.41',
      headers: { host: '10.0.3.15:47101', authorization: `Bearer ${tok}` },
      payload: {
        roomCode: 'LAB3',
        mac: '00-1A-2B-3C-4D-5E',
        hostname: 'LAB3-PC01',
        agent: { protocol: 1, nonce: NONCE },
      },
    })
  ).json<EnrollResponse & { agent: EnrollAgentAnswer }>();
  const night = s.schedules.create(
    {
      name: 'Desligar 22:40',
      weekdays: 31,
      timeLocal: '22:40',
      target: { type: 'rooms', roomIds: [room.id] },
    },
    ACTOR,
  ).id;
  s.db.run(
    `UPDATE schedules SET action = 'shutdown', warning_minutes = 5, allow_postpone = 1,
       postpone_max = 2, postpone_minutes = 15 WHERE id = ?`,
    [night],
  );
  changeLog(s.db).touch('schedule', night);

  const request = (over: Partial<CheckinRequest> = {}): CheckinRequest => ({
    protocol: 1,
    nonce: NONCE,
    agentVersion: '1.3.0',
    bootTime: sp(12, 7),
    clock: h.clock.now() - 2_000,
    freeze: { product: null, state: 'none', persistent: false },
    power: { sleepAfterMinutes: 30, wakeTimers: 'enabled' },
    session: { loggedOn: true, sessions: 1 },
    reports: [],
    ackedOrders: [],
    ...over,
  });
  const checkin = (body: object = request(), token: string | null = enrolled.agent.token) =>
    agent.inject({
      method: 'POST',
      url: '/agent/v1/checkin',
      remoteAddress: '10.0.3.41',
      headers: {
        host: '10.0.3.15:47101',
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      },
      payload: body,
    });
  const order = (n: number, over: Record<string, unknown> = {}) => {
    const row = {
      uuid: uuid(900 + n),
      device_id: enrolled.deviceId,
      action: 'shutdown',
      warning_minutes: 1,
      allow_postpone: 0,
      postpone_max: 0,
      postpone_minutes: 15,
      state: 'pending',
      created_at: h.clock.now(),
      expires_at: h.clock.now() + 2 * 3_600_000,
      ...over,
    };
    const cols = Object.keys(row);
    s.db.run(
      `INSERT INTO power_orders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      Object.values(row),
    );
    return row.uuid;
  };
  return {
    h,
    s,
    agent,
    checkin,
    request,
    order,
    deviceId: enrolled.deviceId,
    token: enrolled.agent.token,
  };
}

const report = (n: number, over: Partial<AgentReport> = {}): AgentReport => ({
  uuid: uuid(n),
  occurrence: uuid(500 + n),
  order: null,
  action: 'shutdown',
  outcome: 'done',
  reason: null,
  plannedAt: sp(9, 22, 40),
  executedAt: sp(9, 23, 10),
  postpones: 2,
  userLoggedOn: true,
  sessions: 1,
  wasAsleep: false,
  lateMinutes: null,
  nativeWarning: false,
  freezeState: 'none',
  detail: null,
  ...over,
});

describe('check-in (FR-302.1, ADR-044)', () => {
  it('AC-302-01: a valid token gets orders, agenda and a signature over the body and its nonce', async () => {
    const { s, checkin } = await setup();
    const r = await checkin();
    expect(r.statusCode).toBe(200);
    const a = checkinAnswerSchema.parse(r.json());
    const sig = String(r.headers['x-uniwake-signature']);
    expect(r.headers['x-uniwake-key']).toBe(s.hubKey.keyId());
    expect(verifySigned(s.hubKey.publicKey(), NONCE, r.rawPayload, sig)).toBe(true);
    expect(verifySigned(s.hubKey.publicKey(), 'outro-nonce-aaaaaaaaaa', r.rawPayload, sig)).toBe(
      false,
    );
    expect(a.serverTime).toBe(s.clock.now());
    expect(a.agenda.items[0]!.at).toBe(sp(12, 22, 40));
    expect(a.agenda.items).toHaveLength(10); // Mon–Fri, two weeks
    expect(a.message.warning).toContain('{hora}');
    expect(a.hubs.list).toEqual([
      expect.objectContaining({ urls: ['http://10.0.3.15:47101'], keyId: s.hubKey.keyId() }),
    ]);
    expect(a.scripts['uniwake-aviso.ps1'].sha256).toBe(tokenHash('# uniwake-aviso.ps1'));
    expect(a.newToken).toBeNull();
  });

  it('AC-302-02: a revoked, unknown or missing token gets 401 and no data', async () => {
    const { s, checkin, deviceId, token } = await setup();
    for (const t of [null, 'x'.repeat(43), 'curto']) {
      const r = await checkin(undefined, t);
      expect(r.statusCode).toBe(401);
      expect(r.json<{ code: string }>().code).toBe('AGENT_TOKEN_INVALID');
      expect(r.body).not.toContain('agenda');
    }
    s.agentTokens.revoke(deviceId, 'LAB3-PC01', ACTOR);
    const revoked = await checkin(undefined, token);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.headers['x-uniwake-signature']).toBeUndefined();
  });

  it('AC-302-03: the 7th check-in in a minute with one token gets 429', async () => {
    const { h, checkin } = await setup();
    for (let i = 0; i < 6; i++) expect((await checkin()).statusCode).toBe(200);
    const seventh = await checkin();
    expect(seventh.statusCode).toBe(429);
    expect(seventh.json<{ code: string }>().code).toBe('AGENT_RATE_LIMITED');
    h.clock.set(h.clock.now() + 61_000);
    expect((await checkin()).statusCode).toBe(200);
  });

  it('accepts bodies up to 64 KB (50 reports), refuses larger ones and unknown fields', async () => {
    const { checkin, request } = await setup();
    const big = request({
      reports: Array.from({ length: 50 }, (_, i) => report(i, { detail: 'x'.repeat(500) })),
    });
    expect(Buffer.byteLength(JSON.stringify(big))).toBeGreaterThan(8 * 1024);
    expect((await checkin(big)).statusCode).toBe(200);
    const huge = { ...request(), pad: 'x'.repeat(70 * 1024) };
    expect((await checkin(huge)).statusCode).toBe(413);
    const withUser = request({
      session: { loggedOn: true, sessions: 1, userName: 'aluno' } as never,
    });
    expect((await checkin(withUser)).statusCode).toBe(422);
  });
});

describe('reports, orders and status (FR-302, FR-304.5, FR-305)', () => {
  it('stores each report once and acknowledges it every time it is sent', async () => {
    const { s, h, checkin, request } = await setup();
    const body = request({ reports: [report(1), report(2)] });
    expect((await checkin(body)).json<CheckinAnswer>().ackReports).toEqual([uuid(1), uuid(2)]);
    h.clock.set(h.clock.now() + 61_000);
    expect(
      (await checkin({ ...body, clock: h.clock.now() })).json<CheckinAnswer>().ackReports,
    ).toEqual([uuid(1), uuid(2)]);
    expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM power_reports')!.n).toBe(2);
    expect(
      s.db.get(
        'SELECT postpones, user_logged_on, session_count FROM power_reports WHERE uuid = ?',
        [uuid(1)],
      ),
    ).toEqual({ postpones: 2, user_logged_on: 1, session_count: 1 });
  });

  it('repeats an order until acknowledged; a report settles it; a cancel follows a delivered order', async () => {
    const { s, h, checkin, request, order } = await setup();
    const shut = order(1);
    const other = order(2, { action: 'restart' });
    const old = order(3, { expires_at: h.clock.now() - 1 });
    const first = (await checkin()).json<CheckinAnswer>();
    expect(first.orders.map((o) => o.uuid)).toEqual([shut, other]);
    h.clock.set(h.clock.now() + 61_000);
    // Acknowledged now: not sent again.
    const second = (
      await checkin(request({ ackedOrders: [shut, other], clock: h.clock.now() }))
    ).json<CheckinAnswer>();
    expect(second.orders).toEqual([]);
    const state = (u: string) =>
      s.db.get<{ state: string }>('SELECT state FROM power_orders WHERE uuid = ?', [u])!.state;
    expect([state(shut), state(other), state(old)]).toEqual(['delivered', 'delivered', 'expired']);
    // The restart is cancelled after delivery: the machine is told to cancel it.
    s.db.run("UPDATE power_orders SET state = 'cancelled' WHERE uuid = ?", [other]);
    h.clock.set(h.clock.now() + 61_000);
    const third = (
      await checkin(
        request({ reports: [report(7, { occurrence: null, order: shut })], clock: h.clock.now() }),
      )
    ).json<CheckinAnswer>();
    expect(third.orders).toEqual([expect.objectContaining({ action: 'cancel', cancels: other })]);
    expect(state(shut)).toBe('executed');
  });

  it('an order skipped because the machine was off then is settled with the fixed was_off detail', async () => {
    const { s, h, checkin, request, order } = await setup();
    const shut = order(1);
    await checkin();
    h.clock.set(h.clock.now() + 61_000);
    const skipped = report(8, {
      occurrence: null,
      order: shut,
      outcome: 'skipped',
      reason: 'was_off',
      executedAt: null,
      detail: 'máquina estava desligada e foi ligada depois',
    });
    await checkin(request({ ackedOrders: [shut], reports: [skipped], clock: h.clock.now() }));
    const row = s.db.get<{ state: string; detail: string | null }>(
      'SELECT state, detail FROM power_orders WHERE uuid = ?',
      [shut],
    )!;
    expect(row).toEqual({ state: 'failed', detail: WAS_OFF_ORDER_DETAIL });
  });

  it('records the sighting and the status the machine reports, without user names', async () => {
    const { s, checkin, request, deviceId } = await setup();
    await checkin(
      request({
        freeze: { product: 'deep_freeze', state: 'frozen', persistent: true },
        power: { sleepAfterMinutes: 0, wakeTimers: 'important_only' },
        session: { loggedOn: false, sessions: 0 },
      }),
    );
    expect(
      s.db.get(
        'SELECT ip, clock_offset_ms, user_logged_on, session_count FROM agent_seen WHERE device_id = ?',
        [deviceId],
      ),
    ).toEqual({ ip: '10.0.3.41', clock_offset_ms: 2000, user_logged_on: 0, session_count: 0 });
    expect(
      s.db.get(
        `SELECT agent_version, freeze_product, freeze_state, persistent, sleep_after_minutes, wake_timers,
           seen_coarse_at FROM device_agents WHERE device_id = ?`,
        [deviceId],
      ),
    ).toEqual({
      agent_version: '1.3.0',
      freeze_product: 'deep_freeze',
      freeze_state: 'frozen',
      persistent: 1,
      sleep_after_minutes: 0,
      wake_timers: 'important_only',
      seen_coarse_at: sp(12, 12),
    });
  });

  it('after 30 days the answer carries a new token, except for a machine frozen without persistence', async () => {
    const { h, checkin, request } = await setup();
    h.clock.set(h.clock.now() + 31 * DAY);
    const frozen = (
      await checkin(
        request({
          clock: h.clock.now(),
          freeze: { product: 'uwf', state: 'frozen', persistent: false },
        }),
      )
    ).json<CheckinAnswer>();
    expect(frozen.newToken).toBeNull();
    h.clock.set(h.clock.now() + 61_000);
    const fresh = (await checkin(request({ clock: h.clock.now() }))).json<CheckinAnswer>();
    expect(fresh.newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    h.clock.set(h.clock.now() + 61_000);
    expect((await checkin(request({ clock: h.clock.now() }), fresh.newToken)).statusCode).toBe(200);
  });

  it('serves the agent scripts by name and nothing else', async () => {
    const { agent } = await setup();
    const get = (name: string) =>
      agent.inject({ url: `/agent/v1/scripts/${name}`, headers: { host: '10.0.3.15:47101' } });
    const ok = await get('uniwake-agent.ps1');
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('# uniwake-agent.ps1');
    expect((await get('prepare-target.ps1')).statusCode).toBe(404);
    expect((await get('..%2F..%2Fsecret')).statusCode).toBe(404);
  });
});
