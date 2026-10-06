/** M7 break-it pass (Debug & Problem Solver): regressions for the findings in tasks.md M7-F*. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditRow, CreatedEnrollmentToken, Page } from '@uniwake/shared';
import { TestWolService } from '../src/application/test-wol/test-wol-service';
import { SqliteTestWolRepo } from '../src/db/repositories/test-wol-repo';
import { buildApp } from '../src/http/app';
import { registerAgentRoutes } from '../src/http/panel';
import { MemoryLogger } from './fakes/system-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function harness() {
  const h: ApiHarness = await apiHarness(undefined, {
    prepareScript: { bytes: () => Buffer.from('script') },
  });
  const agent: FastifyInstance = await buildApp({
    kind: 'agent',
    hosts: 'any',
    register: (a) => registerAgentRoutes(a, h.services),
  });
  cleanups.push(async () => {
    h.services.testWol.stop();
    await agent.close();
    await h.close();
  });
  return { h, agent, cookie: await h.as('operator') };
}

describe('M7-F1: a computer registered by another of its MACs is updated, not duplicated', () => {
  it('matches the Wi-Fi MAC reported in otherMacs and switches the device to the wired one', async () => {
    const { h, agent, cookie } = await harness();
    const lab = h.services.rooms.create({ name: 'Lab 3' }, ACTOR);
    // Imported from the inventory with its Wi-Fi MAC.
    const pc = h.services.devices.create(
      { name: 'Mesa 7', mac: '00:1A:2B:3C:4D:60', roomId: lab.id },
      ACTOR,
    ).device;
    const t = (
      await h.inject({
        method: 'POST',
        url: '/api/enrollment/tokens',
        cookie,
        payload: { roomId: lab.id },
      })
    ).json<CreatedEnrollmentToken>();
    const r = await agent.inject({
      method: 'POST',
      url: '/agent/enroll',
      headers: { authorization: `Bearer ${t.token}` },
      payload: {
        roomCode: 'LAB3',
        mac: '00-1A-2B-3C-4D-5E',
        otherMacs: ['00-1A-2B-3C-4D-60'],
        hostname: 'LAB3-PC07',
      },
    });
    expect(r.json()).toMatchObject({ result: 'updated', deviceId: pc.id });
    expect(h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices')?.n).toBe(1);
    expect(h.services.devices.get(pc.id)).toMatchObject({
      name: 'Mesa 7',
      mac: '00:1A:2B:3C:4D:5E',
      otherMacs: ['00:1A:2B:3C:4D:60'],
    });
    const audit = (await h.inject({ url: '/api/audit?action=enrollment.enroll', cookie })).json<
      Page<AuditRow>
    >();
    expect(audit.items[0]!.details).toMatchObject({ macChangedFrom: '00:1A:2B:3C:4D:60' });
  });

  it('the wired MAC wins when both are registered as separate devices', async () => {
    const { h, agent, cookie } = await harness();
    const lab = h.services.rooms.create({ name: 'Lab 3' }, ACTOR);
    const wired = h.services.devices.create(
      { name: 'Cabo', mac: '00:1A:2B:3C:4D:5E', roomId: lab.id },
      ACTOR,
    ).device;
    const wifi = h.services.devices.create(
      { name: 'WiFi', mac: '00:1A:2B:3C:4D:60', roomId: lab.id },
      ACTOR,
    ).device;
    const t = (
      await h.inject({
        method: 'POST',
        url: '/api/enrollment/tokens',
        cookie,
        payload: { roomId: lab.id },
      })
    ).json<CreatedEnrollmentToken>();
    const r = await agent.inject({
      method: 'POST',
      url: '/agent/enroll',
      headers: { authorization: `Bearer ${t.token}` },
      payload: {
        roomCode: 'LAB3',
        mac: '00:1A:2B:3C:4D:5E',
        otherMacs: ['00:1A:2B:3C:4D:60'],
        hostname: 'LAB3-PC07',
      },
    });
    expect(r.json()).toMatchObject({ deviceId: wired.id });
    expect(h.services.devices.get(wifi.id).mac).toBe('00:1A:2B:3C:4D:60');
  });
});

describe('M7-F2: stopping the hub during a test-WoL probe arms no new timer', () => {
  it('a step that resolves after stop() does not schedule again', async () => {
    const { h } = await harness();
    const pc = h.services.devices.create(
      { name: 'PC', mac: '00:1A:2B:3C:4D:70', ip: '10.0.3.70' },
      ACTOR,
    ).device;
    let answer: (alive: Set<number>) => void = () => undefined;
    const service = new TestWolService({
      repo: new SqliteTestWolRepo(h.services.db),
      device: (id) => h.services.devices.get(id),
      verifier: {
        check: () =>
          new Promise<Set<number>>((resolve) => {
            answer = resolve;
          }),
      },
      startWake: vi.fn(() => 1),
      jobResult: () => undefined,
      audit: h.services.audit,
      clock: h.clock,
      logger: new MemoryLogger(),
    });
    const before = h.clock.pendingTimers;
    service.start(pc.id, ACTOR);
    await h.clock.advanceAsync(0); // the first probe is now waiting for its answer
    service.stop();
    answer(new Set()); // "off": the step would schedule the next probe
    await h.clock.advanceAsync(0);
    expect(h.clock.pendingTimers).toBe(before);
  });
});
