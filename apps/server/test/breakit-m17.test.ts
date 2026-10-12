/** M17-D break-it pass (tasks.md checklist) for the agent channel and power orders. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentReport,
  CheckinRequest,
  CreatedEnrollmentToken,
  EnrollAgentAnswer,
  EnrollResponse,
} from '@uniwake/shared';
import { tokenHash } from '../src/application/power/agent-tokens';
import { buildApp } from '../src/http/app';
import { registerAgentRoutes } from '../src/http/panel';
import { applyRemote, changesSince } from '../src/db/sync/apply';
import { verifyChangeLog } from '../src/db/sync/change-log';
import { SqlitePowerRepo } from '../src/db/repositories/power-repo';
import { createServices, type Services } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const NONCE = 'q5KX2nX0v4m8Zk1d0b7S9w';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const report = (over: Partial<AgentReport> = {}): AgentReport => ({
  uuid: 'a1b2c3d4-0000-4000-8000-000000000001',
  occurrence: 'b1b2c3d4-0000-4000-8000-000000000001',
  order: null,
  action: 'shutdown',
  outcome: 'done',
  reason: null,
  plannedAt: T0,
  executedAt: T0 + 60_000,
  postpones: 1,
  userLoggedOn: true,
  sessions: 1,
  wasAsleep: false,
  lateMinutes: null,
  nativeWarning: false,
  freezeState: 'none',
  detail: null,
  ...over,
});

describe('M17-D: the same report sent to two team hubs', () => {
  it('ends as one row on each hub, without a "conflito resolvido"', () => {
    const pcs: { s: Services; clock: FakeClock }[] = [];
    for (let i = 0; i < 2; i++) {
      const clock = new FakeClock(T0);
      const s = createServices(testDb(), clock, fakePorts(clock));
      pcs.push({ s, clock });
      cleanups.push(async () => {
        expect(verifyChangeLog(s.db)).toEqual([]);
        s.scheduler.stop();
        s.db.close();
      });
    }
    const [a, b] = pcs as [(typeof pcs)[0], (typeof pcs)[0]];
    const pull = (to: typeof a, from: typeof a) =>
      applyRemote(to.s.db, changesSince(from.s.db, 0).entries, {
        now: to.clock.now(),
        peerAckedSeq: 0,
        peerInstance: from.s.health.details().instanceId,
      });
    const deviceA = a.s.devices.create({ name: 'PC-01', mac: '00:AA:00:00:00:01' }, ACTOR).device
      .id;
    pull(b, a);
    const deviceB = b.s.db.get<{ id: number }>('SELECT id FROM devices')!.id;
    // The PC reported to A, lost A's answer, and sent the same report to B a minute later.
    new SqlitePowerRepo(a.s.db).insertReport(deviceA, report(), T0 + 120_000);
    b.clock.set(T0 + 180_000);
    new SqlitePowerRepo(b.s.db).insertReport(deviceB, report(), T0 + 180_000);
    const conflicts = [...pull(b, a).conflicts, ...pull(a, b).conflicts];
    expect(conflicts).toEqual([]); // nothing for "Conflitos resolvidos"
    for (const p of [a, b]) {
      expect(p.s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM power_reports')!.n).toBe(1);
    }
  });
});

describe('M17-D: a check-in that fails half way', () => {
  async function setup() {
    const h: ApiHarness = await apiHarness(undefined, {
      agentScripts: { get: (n) => ({ bytes: Buffer.from(n), sha256: tokenHash(n) }) },
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
    const room = h.services.rooms.create({ name: 'Lab 3' }, ACTOR).id;
    const tok = (
      await h.inject({
        method: 'POST',
        url: '/api/enrollment/tokens',
        cookie,
        payload: { roomId: room },
      })
    ).json<CreatedEnrollmentToken>().token;
    const enrolled = (
      await agent.inject({
        method: 'POST',
        url: '/agent/enroll',
        headers: { host: '10.0.3.15:47101', authorization: `Bearer ${tok}` },
        payload: {
          roomCode: 'LAB3',
          mac: '00-1A-2B-3C-4D-5E',
          hostname: 'PC',
          agent: { protocol: 1, nonce: NONCE },
        },
      })
    ).json<EnrollResponse & { agent: EnrollAgentAnswer }>();
    const checkin = (body: CheckinRequest) =>
      agent.inject({
        method: 'POST',
        url: '/agent/v1/checkin',
        headers: { host: '10.0.3.15:47101', authorization: `Bearer ${enrolled.agent.token}` },
        payload: body,
      });
    return { h, checkin, deviceId: enrolled.deviceId };
  }

  it('keeps nothing of it: no report stored, no order marked received (the machine just retries)', async () => {
    const { h, checkin, deviceId } = await setup();
    const s = h.services;
    const job = s.power.start(
      {
        action: 'shutdown',
        target: { type: 'devices', deviceIds: [deviceId] },
        warning: 'short',
        confirmProtected: false,
      },
      ACTOR,
    );
    const order = s.db.get<{ uuid: string }>('SELECT uuid FROM power_orders')!.uuid;
    // The hub dies after storing the report but before the end of the check-in.
    s.db.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON agent_seen BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    );
    const body: CheckinRequest = {
      protocol: 1,
      nonce: NONCE,
      agentVersion: '1.3.0',
      bootTime: null,
      clock: h.clock.now(),
      freeze: { product: null, state: 'none', persistent: false },
      power: { sleepAfterMinutes: null, wakeTimers: 'unknown' },
      session: { loggedOn: false, sessions: 0 },
      reports: [report({ occurrence: null, order })],
      ackedOrders: [order],
    };
    expect((await checkin(body)).statusCode).toBe(500);
    expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM power_reports')!.n).toBe(0);
    expect(s.db.get<{ state: string }>('SELECT state FROM power_orders')!.state).toBe('pending');
    s.db.exec('DROP TRIGGER boom');
    h.clock.set(h.clock.now() + 1_000);
    expect((await checkin({ ...body, clock: h.clock.now() })).statusCode).toBe(200);
    expect(s.db.get<{ state: string }>('SELECT state FROM power_orders')!.state).toBe('executed');
    expect(s.power.get(job.jobId).counts.pending).toBe(0);
  });
});

describe('M17-R: the replicated last check-in', () => {
  it('is the exact time, refreshed at most every 30 min (no false "perdido" on another team hub)', async () => {
    const h = await apiHarness(undefined, {
      agentScripts: { get: (n) => ({ bytes: Buffer.from(n), sha256: tokenHash(n) }) },
    });
    cleanups.push(() => h.close());
    const s = h.services;
    const deviceId = s.devices.create({ name: 'PC-01', mac: '00:AA:00:00:00:01' }, ACTOR).device.id;
    const { token } = await s.agent.enrollAnswer(deviceId);
    const base = h.clock.now() + 7 * 60_000; // not on a 30-min boundary
    const at = (t: number) => {
      h.clock.set(t);
      s.agent.checkin(
        s.agent.identify(token),
        {
          protocol: 1,
          nonce: NONCE,
          agentVersion: '1.3.0',
          bootTime: null,
          clock: t,
          freeze: { product: null, state: 'none', persistent: false },
          power: { sleepAfterMinutes: null, wakeTimers: 'unknown' },
          session: { loggedOn: false, sessions: 0 },
          reports: [],
          ackedOrders: [],
        },
        { ip: null, host: undefined },
      );
      return s.db.get<{ c: number }>('SELECT seen_coarse_at AS c FROM device_agents')!.c;
    };
    expect(at(base)).toBe(base);
    expect(at(base + 10 * 60_000)).toBe(base); // no write within 30 min
    expect(at(base + 31 * 60_000)).toBe(base + 31 * 60_000);
    // Another hub seeing only this time: the machine checked in after it came online → ready.
    expect(s.powerStatus.device(deviceId).lastCheckin).toBe(base + 31 * 60_000);
  });
});
