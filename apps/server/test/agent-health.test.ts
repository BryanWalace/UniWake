/**
 * v1.6.0 (spec §6e, FR-603/604, ADR-059): the hub stores the health a lab PC sends, announces the
 * feature, and takes the repair task's alert. Agent listener only; nothing leaves the process.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentHealth, CheckinAnswer } from '@uniwake/shared';
import { readHealth } from '../src/db/repositories/power-repo';
import { agentWorld, type AgentWorld } from './helpers/fake-agent';

const ACTOR = { id: null, label: 'teste' };
const worlds: AgentWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});

const HEALTH = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'packages',
      'shared',
      'fixtures',
      'agent',
      'checkin-health.json',
    ),
    'utf8',
  ),
) as AgentHealth;

async function world() {
  const w = await agentWorld();
  worlds.push(w);
  const s = w.h.services;
  const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
  const pc = s.devices.create(
    { name: 'LAB1-PC05', mac: '00:AA:00:00:00:05', roomId: room.id },
    ACTOR,
  ).device.id;
  const token = s.agentTokens.issue(pc);
  const checkin = (extra: Record<string, unknown> = {}) =>
    w.listener.inject({
      method: 'POST',
      url: '/agent/v1/checkin',
      remoteAddress: '10.0.3.45',
      headers: { host: '10.0.3.15:47101', authorization: `Bearer ${token}` },
      payload: {
        protocol: 1,
        nonce: 'q5KX2nX0v4m8Zk1d0b7S9w',
        agentVersion: '1.7.0',
        bootTime: w.h.clock.now() - 3_600_000,
        clock: w.h.clock.now(),
        freeze: { product: null, state: 'none', persistent: false },
        power: { sleepAfterMinutes: 0, wakeTimers: 'enabled' },
        session: { loggedOn: false, sessions: 0 },
        reports: [],
        ackedOrders: [],
        ...extra,
      },
    });
  const alert = (body: unknown, auth = `Bearer ${token}`) =>
    w.listener.inject({
      method: 'POST',
      url: '/agent/v1/alert',
      remoteAddress: '10.0.3.45',
      headers: { host: '10.0.3.15:47101', authorization: auth },
      payload: body as Record<string, unknown>,
    });
  return { w, s, pc, checkin, alert };
}

describe('agent health on the hub (FR-603.1, FR-603.5)', () => {
  it('AC-603-01: answers announce health; a check-in without it is accepted; with it, it is stored', async () => {
    const { w, s, pc, checkin } = await world();
    const plain = await checkin();
    expect(plain.statusCode).toBe(200);
    expect(plain.json<CheckinAnswer>().features).toEqual(['health']);
    expect(readHealth(s.db, pc)).toBeNull();

    const r = await checkin({ health: HEALTH });
    expect(r.statusCode).toBe(200);
    expect(readHealth(s.db, pc)).toMatchObject({
      installLevel: 2,
      update: { outcome: 'write_blocked', code: 225, file: 'uniwake-aviso.ps1' },
      repairs: [{ outcome: 'restored', reason: 'missing' }],
      antivirus: { products: [{ name: 'Microsoft Defender Antivirus' }] },
      antivirusAt: w.h.clock.now(),
    });

    // "antivirus: null" means unchanged: the stored list stays.
    w.h.clock.advance(60_000);
    await checkin({ health: { ...HEALTH, antivirus: null, update: null } });
    const kept = readHealth(s.db, pc)!;
    expect(kept.update).toBeNull();
    expect(kept.antivirus?.detections).toHaveLength(1);
    expect(kept.receivedAt).toBe(w.h.clock.now());
  });

  it("FR-603.4: the repair task's alert is stored; bad tokens and bodies are refused", async () => {
    const { s, pc, alert } = await world();
    const body = {
      protocol: 1,
      kind: 'agent_missing',
      file: 'uniwake-agent.ps1',
      at: 1791850800000,
    };
    expect((await alert(body)).statusCode).toBe(204);
    expect(readHealth(s.db, pc)!.alert).toEqual({ file: 'uniwake-agent.ps1', at: 1791850800000 });
    expect((await alert(body, 'Bearer ' + 'x'.repeat(43))).statusCode).toBe(401);
    expect((await alert({ ...body, kind: 'outra coisa' })).statusCode).toBe(422);
    expect((await alert({ ...body, run: 'calc.exe' })).statusCode).toBe(422);
  });
});
