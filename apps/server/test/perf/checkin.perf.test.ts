/**
 * NFR-301 (M20-T03): 500 lab PCs checking in every 60 s (≈ 8.3 requests/s). Each simulated agent
 * goes through the real agent listener (token, limits, validation, store, agenda, signature); a
 * check-in without changes must cost ≤ 5 ms of hub time, and the agenda is served from the
 * per-device cache until relevant data change.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CheckinRequest } from '@uniwake/shared';
import { tokenHash } from '../../src/application/power/agent-tokens';
import { baselineChangeLog, changeLog } from '../../src/db/sync/change-log';
import { buildApp } from '../../src/http/app';
import { registerAgentRoutes } from '../../src/http/panel';
import { apiHarness, type ApiHarness } from '../helpers/api';
import { relogPower } from '../helpers/db';

const ACTOR = { id: null, label: 'perf' };
const AGENTS = 500;
const NONCE = 'q5KX2nX0v4m8Zk1d0b7S9w';

let h: ApiHarness;
let agent: FastifyInstance;
const tokens: string[] = [];

beforeAll(async () => {
  h = await apiHarness(undefined, {
    agentScripts: {
      get: (name) => ({ bytes: Buffer.from(`# ${name}`), sha256: tokenHash(`# ${name}`) }),
    },
  });
  h.clock.set(Date.UTC(2026, 9, 12, 15)); // Monday, 12:00 in São Paulo
  agent = await buildApp({
    kind: 'agent',
    hosts: 'any',
    bodyLimit: 8 * 1024,
    register: (a) => registerAgentRoutes(a, h.services),
  });
  const s = h.services;
  const rooms = Array.from(
    { length: 10 },
    (_, i) => s.rooms.create({ name: `Lab ${i + 1}` }, ACTOR).id,
  );
  const ids: number[] = [];
  s.db.transaction(() => {
    for (let i = 0; i < AGENTS; i++) {
      ids.push(
        Number(
          s.db.run(
            'INSERT INTO devices (name, mac, room_id, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
            [
              `Bench-${String(i).padStart(3, '0')}`,
              `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
              rooms[i % rooms.length]!,
            ],
          ).lastInsertRowid,
        ),
      );
    }
  });
  baselineChangeLog(s.db);
  for (const id of ids) tokens.push(s.agentTokens.issue(id));
  // A realistic agenda: a nightly shutdown for every room and a morning wake.
  const night = s.schedules.create(
    {
      name: 'Desligar 22:40',
      weekdays: 31,
      timeLocal: '22:40',
      target: { type: 'rooms', roomIds: rooms },
      confirm: { count: AGENTS },
    },
    ACTOR,
  ).id;
  s.db.run(
    `UPDATE schedules SET action = 'shutdown', warning_minutes = 5, allow_postpone = 1,
       postpone_max = 2, postpone_minutes = 15 WHERE id = ?`,
    [night],
  );
  changeLog(s.db).touch('schedule', night);
  s.schedules.create(
    {
      name: 'Ligar 07:00',
      weekdays: 31,
      timeLocal: '07:00',
      target: { type: 'all' },
      confirm: { count: AGENTS },
    },
    ACTOR,
  );
  await s.hubKey.ensure();
});

afterAll(async () => {
  await agent.close();
  relogPower(h.services.db);
  await h.close();
});

const request = (): CheckinRequest => ({
  protocol: 1,
  nonce: NONCE,
  agentVersion: '1.3.0',
  bootTime: Date.UTC(2026, 9, 12, 10),
  clock: h.clock.now(),
  freeze: { product: null, state: 'none', persistent: false },
  power: { sleepAfterMinutes: 30, wakeTimers: 'enabled' },
  session: { loggedOn: false, sessions: 0 },
  reports: [],
  ackedOrders: [],
});

/** One check-in of every agent; returns each request's wall time in ms. */
async function round(): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < AGENTS; i++) {
    const t = performance.now();
    const r = await agent.inject({
      method: 'POST',
      url: '/agent/v1/checkin',
      remoteAddress: `10.1.${i >> 8}.${i & 255}`,
      headers: { host: '10.0.3.15:47101', authorization: `Bearer ${tokens[i]}` },
      payload: request(),
    });
    times.push(performance.now() - t);
    if (r.statusCode !== 200) throw new Error(`check-in ${i}: ${r.statusCode} ${r.body}`);
  }
  return times;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;

describe('500 agents checking in (NFR-301)', () => {
  it('a check-in without changes costs ≤ 5 ms on average (a minute of load in < 2.5 s of hub time)', async () => {
    await round(); // first contact: builds each agenda, warms statements
    h.clock.set(h.clock.now() + 60_000);
    const times = await round();
    // Whole minute of 500 check-ins: far below the 60 s they are spread over.
    expect(times.reduce((a, b) => a + b, 0)).toBeLessThan(AGENTS * 5);
    expect(mean(times)).toBeLessThan(5);
    expect(p95(times)).toBeLessThan(15);
  });

  it('the agenda comes from the per-device cache until relevant data change', () => {
    const agenda = h.services.agenda;
    const first = agenda.forDevice(1)!;
    let t = performance.now();
    for (let i = 1; i <= AGENTS; i++) agenda.forDevice(i);
    const cached = performance.now() - t;
    expect(agenda.forDevice(1)).toBe(first); // same object: not rebuilt
    expect(cached).toBeLessThan(50);
    // A schedule change invalidates it.
    h.services.schedules.create(
      {
        name: 'Ligar 13:00',
        weekdays: 31,
        timeLocal: '13:00',
        target: { type: 'all' },
        confirm: { count: AGENTS },
      },
      ACTOR,
    );
    t = performance.now();
    const rebuilt = agenda.forDevice(1)!;
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.version).not.toBe(first.version);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
