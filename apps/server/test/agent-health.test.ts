/**
 * v1.6.0 (spec §6e, FR-603/604, ADR-059): the hub stores the health a lab PC sends, announces the
 * feature, and takes the repair task's alert. Agent listener only; nothing leaves the process.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentHealth, CheckinAnswer, DeviceAgentInfo } from '@uniwake/shared';
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

describe('what the panel shows (FR-603.5, FR-604.2)', () => {
  /** A hub that ships agent 1.7.0, with a blocked machine, an outdated one and a fine one. */
  async function panel() {
    const w = await agentWorld({
      agentScripts: {
        get: (name: string) => {
          const bytes = Buffer.from(
            name === 'uniwake-agent.ps1' ? "$script:UwAgentVersion = '1.7.0'\n" : '# aviso',
          );
          return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
        },
      },
    });
    worlds.push(w);
    const s = w.h.services;
    const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
    const dev = (name: string, mac: string) =>
      s.devices.create({ name, mac, roomId: room.id }, ACTOR).device.id;
    const ids = {
      blocked: dev('LAB1-PC01', '00:AA:00:00:00:01'),
      outdated: dev('LAB1-PC02', '00:AA:00:00:00:02'),
      fine: dev('LAB1-PC03', '00:AA:00:00:00:03'),
    };
    const send = async (id: number, version: string, health?: AgentHealth) => {
      const token = s.agentTokens.issue(id);
      const r = await w.listener.inject({
        method: 'POST',
        url: '/agent/v1/checkin',
        remoteAddress: '10.0.3.45',
        headers: { host: '10.0.3.15:47101', authorization: `Bearer ${token}` },
        payload: {
          protocol: 1,
          nonce: 'q5KX2nX0v4m8Zk1d0b7S9w',
          agentVersion: version,
          bootTime: w.h.clock.now() - 3_600_000,
          clock: w.h.clock.now(),
          freeze: { product: null, state: 'none', persistent: false },
          power: { sleepAfterMinutes: 0, wakeTimers: 'enabled' },
          session: { loggedOn: false, sessions: 0 },
          reports: [],
          ackedOrders: [],
          ...(health ? { health } : {}),
        },
      });
      expect(r.statusCode).toBe(200);
    };
    const recent = { ...HEALTH, repairs: [], antivirus: { ...HEALTH.antivirus!, detections: [] } };
    const detection = {
      ...recent,
      update: null,
      antivirus: {
        ...HEALTH.antivirus!,
        detections: [{ ...HEALTH.antivirus!.detections[0]!, at: w.h.clock.now() - 60_000 }],
      },
    };
    return { w, s, ids, send, recent, detection, cookie: await w.h.as('operator') };
  }

  it('AC-604-01: a Defender detection creates one notice naming product, file and time; repeats add nothing', async () => {
    const { w, s, ids, send, detection } = await panel();
    await send(ids.blocked, '1.7.0', detection);
    await send(ids.blocked, '1.7.0', detection); // the same report again
    const notices = s.db.all<{ data: string }>(
      "SELECT data FROM notices WHERE type = 'agent_blocked'",
    );
    expect(notices).toHaveLength(1);
    const events = (JSON.parse(notices[0]!.data) as { events: Record<string, unknown>[] }).events;
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'detection',
        deviceName: 'LAB1-PC01',
        file: 'uniwake-agent.ps1',
        threat: 'Trojan:PowerShell/Teste.A',
        product: 'Microsoft Defender Antivirus',
        at: w.h.clock.now() - 60_000,
      }),
    ]);
    // A blocked update and the repair task's alert join the same notice.
    await send(ids.blocked, '1.7.0', { ...detection, update: HEALTH.update });
    await w.listener.inject({
      method: 'POST',
      url: '/agent/v1/alert',
      remoteAddress: '10.0.3.45',
      headers: {
        host: '10.0.3.15:47101',
        authorization: `Bearer ${s.agentTokens.issue(ids.blocked)}`,
      },
      payload: { protocol: 1, kind: 'agent_missing', file: 'uniwake-agent.ps1', at: 1791850900000 },
    });
    const all = (
      JSON.parse(
        s.db.get<{ data: string }>("SELECT data FROM notices WHERE type = 'agent_blocked'")!.data,
      ) as { events: { kind: string }[] }
    ).events.map((e) => e.kind);
    expect(all).toEqual(['detection', 'update_blocked', 'agent_missing']);
  });

  it('AC-603-05: device page health, list marks and the health page counts', async () => {
    const { w, ids, send, recent, cookie } = await panel();
    await send(ids.blocked, '1.7.0', recent); // write_blocked (code 225)
    await send(ids.outdated, '1.6.0');
    await send(ids.fine, '1.7.0', {
      ...recent,
      update: { ...recent.update!, outcome: 'updated', code: null },
    });
    const page = (
      await w.h.inject({ method: 'GET', url: `/api/devices/${ids.blocked}/agent`, cookie })
    ).json<DeviceAgentInfo>();
    expect(page).toMatchObject({
      latestVersion: '1.7.0',
      agentAlert: 'blocked',
      health: {
        installLevel: 2,
        update: { outcome: 'write_blocked', code: 225 },
        antivirus: { products: [{ name: 'Microsoft Defender Antivirus' }] },
      },
    });
    const list = (await w.h.inject({ method: 'GET', url: '/api/power/agents', cookie })).json<
      DeviceAgentInfo[]
    >();
    const mark = new Map(list.map((a) => [a.deviceId, a.agentAlert]));
    expect([mark.get(ids.blocked), mark.get(ids.outdated), mark.get(ids.fine)]).toEqual([
      'blocked',
      'outdated',
      null,
    ]);
    expect(list.every((a) => a.health === undefined)).toBe(true); // the list stays small
    const health = (await w.h.inject({ method: 'GET', url: '/api/health/details', cookie })).json<{
      warnings: { code: string; message: string }[];
    }>();
    const codes = Object.fromEntries(health.warnings.map((x) => [x.code, x.message]));
    expect(codes.agent_blocked).toContain('LAB1-PC01');
    expect(codes.agent_outdated).toContain('LAB1-PC02');
  });
});
