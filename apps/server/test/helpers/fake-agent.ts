/**
 * A fake lab-PC agent for hub tests (v1.6, spec §6d): checks in through the real agent listener and
 * follows the agent's rules that matter to the hub — orders first, agenda items when their warning
 * starts, each run id (occurrence) executed once, reports with the path that ran it. "Executing" a
 * shutdown only marks the device offline in the monitor table: nothing real is shut down.
 */
import type { FastifyInstance } from 'fastify';
import type { AgentReport, CheckinAnswer } from '@uniwake/shared';
import { tokenHash } from '../../src/application/power/agent-tokens';
import { buildApp } from '../../src/http/app';
import { registerAgentRoutes } from '../../src/http/panel';
import { apiHarness, type ApiHarness } from './api';

let reportSeq = 0;
const reportUuid = () => `a1b2c3d4-0000-4000-8000-${String(++reportSeq).padStart(12, '0')}`;

export interface FakeAgent {
  deviceId: number;
  /** Run ids (occurrences and orders) already handled, like the agent's doneIds. */
  done: Set<string>;
  executions: { runId: string; path: 'agenda' | 'order'; at: number }[];
  agenda: CheckinAnswer['agenda'] | null;
  orders: CheckinAnswer['orders'];
  /** Logged-on user: the warning is postponed `postponeWith` times before shutting down. */
  userActive: boolean;
  /** One check-in (returns false when the hub does not answer, e.g. "off" or standby). */
  checkin(): Promise<boolean>;
  /** What the agent would run now from what it holds (orders first, then due agenda items). */
  step(now: number): void;
}

export async function agentWorld(opts: Parameters<typeof apiHarness>[1] = {}) {
  const h = await apiHarness(undefined, {
    agentScripts: {
      get: (name) => ({ bytes: Buffer.from(`# ${name}`), sha256: tokenHash(`# ${name}`) }),
    },
    ...opts,
  });
  const listener: FastifyInstance = await buildApp({
    kind: 'agent',
    hosts: 'any',
    bodyLimit: 8 * 1024,
    register: (a) => registerAgentRoutes(a, h.services),
  });
  let hubUp = true;
  const close = async () => {
    await listener.close();
    await h.close();
  };

  function agent(deviceId: number, ip = '10.0.3.41'): FakeAgent {
    const token = h.services.agentTokens.issue(deviceId);
    const pending: AgentReport[] = [];
    const acks: string[] = [];
    const a: FakeAgent = {
      deviceId,
      done: new Set(),
      executions: [],
      agenda: null,
      orders: [],
      userActive: false,
      async checkin() {
        if (!hubUp) return false;
        const r = await listener.inject({
          method: 'POST',
          url: '/agent/v1/checkin',
          remoteAddress: ip,
          headers: { host: '10.0.3.15:47101', authorization: `Bearer ${token}` },
          payload: {
            protocol: 1,
            nonce: 'q5KX2nX0v4m8Zk1d0b7S9w',
            agentVersion: '1.6.0',
            bootTime: h.clock.now() - 3_600_000,
            clock: h.clock.now(),
            freeze: { product: null, state: 'none', persistent: false },
            power: { sleepAfterMinutes: 0, wakeTimers: 'enabled' },
            session: { loggedOn: a.userActive, sessions: a.userActive ? 1 : 0 },
            reports: pending.splice(0),
            ackedOrders: acks.splice(0),
          },
        });
        if (r.statusCode !== 200) {
          if (process.env.FAKE_AGENT_DEBUG) console.log(r.statusCode, r.body);
          return false;
        }
        const answer = r.json<CheckinAnswer>();
        a.agenda = answer.agenda;
        for (const o of answer.orders) {
          if (o.action === 'cancel') continue;
          const run = ('occurrence' in o && o.occurrence) || o.uuid;
          if (a.done.has(run) || a.done.has(o.uuid)) continue;
          if (!a.orders.some((x) => x.uuid === o.uuid)) a.orders.push(o);
          acks.push(o.uuid);
        }
        return true;
      },
      step(now) {
        const run = (
          runId: string,
          path: 'agenda' | 'order',
          order: string | null,
          planned: number | null,
        ) => {
          a.done.add(runId);
          if (order) a.done.add(order);
          a.executions.push({ runId, path, at: now });
          pending.push({
            uuid: reportUuid(),
            occurrence: path === 'agenda' || order !== runId ? runId : null,
            order,
            action: 'shutdown',
            outcome: 'done',
            reason: null,
            plannedAt: planned,
            executedAt: now,
            postpones: 0,
            userLoggedOn: a.userActive,
            sessions: a.userActive ? 1 : 0,
            wasAsleep: false,
            lateMinutes: null,
            nativeWarning: false,
            freezeState: 'none',
            detail: null,
          });
          h.services.db.run(
            "UPDATE device_state SET status = 'offline', online_since = NULL WHERE device_id = ?",
            [deviceId],
          );
        };
        const order = a.orders.shift();
        if (order && order.action !== 'cancel') {
          const runId = ('occurrence' in order && order.occurrence) || order.uuid;
          if (!a.done.has(runId)) return run(runId, 'order', order.uuid, null);
        }
        for (const item of a.agenda?.items ?? []) {
          const warningStart = item.at - item.warningMinutes * 60_000;
          if (now >= warningStart && now <= item.at + 60 * 60_000 && !a.done.has(item.occurrence)) {
            return run(item.occurrence, 'agenda', null, item.at);
          }
        }
      },
    };
    return a;
  }

  return {
    h,
    listener,
    close,
    agent,
    /** The hub process "off" (FR-501.4: no check-in answers, no scheduler ticks). */
    setHub(up: boolean) {
      hubUp = up;
    },
  };
}

export type AgentWorld = Awaited<ReturnType<typeof agentWorld>>;
export type { ApiHarness };
