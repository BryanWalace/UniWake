/**
 * v1.7.0 (spec §6f, FR-702.2, FR-703.3, FR-704.2/704.3): what the 1.8.0 agent tells the hub about
 * Wake-on-LAN, forced shutdowns and its own errors is stored, shown on the device page and written
 * to the hub log with the machine's name. Agent listener only; nothing leaves the process.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentHealth, DeviceAgentInfo } from '@uniwake/shared';
import { readHealth } from '../src/db/repositories/power-repo';
import { agentWorld, type AgentWorld } from './helpers/fake-agent';

const ACTOR = { id: null, label: 'teste' };
const worlds: AgentWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});

const BASE: AgentHealth = { installLevel: 3, update: null, repairs: [], antivirus: null };

async function world() {
  const w = await agentWorld();
  worlds.push(w);
  const s = w.h.services;
  const room = s.rooms.create({ name: 'Lab 1' }, ACTOR);
  const pc = s.devices.create(
    { name: 'LAB1-PC07', mac: '00:AA:00:00:00:07', roomId: room.id },
    ACTOR,
  ).device.id;
  const token = s.agentTokens.issue(pc);
  const checkin = async (health: Partial<AgentHealth> | null, reports: unknown[] = []) => {
    const r = await w.listener.inject({
      method: 'POST',
      url: '/agent/v1/checkin',
      remoteAddress: '10.0.3.47',
      headers: { host: '10.0.3.15:47101', authorization: `Bearer ${token}` },
      payload: {
        protocol: 1,
        nonce: 'q5KX2nX0v4m8Zk1d0b7S9w',
        agentVersion: '1.8.0',
        bootTime: w.h.clock.now() - 3_600_000,
        clock: w.h.clock.now(),
        freeze: { product: null, state: 'none', persistent: false },
        power: { sleepAfterMinutes: 0, wakeTimers: 'enabled' },
        session: { loggedOn: false, sessions: 0 },
        reports,
        ackedOrders: [],
        ...(health ? { health: { ...BASE, ...health } } : {}),
      },
    });
    expect(r.statusCode, r.body).toBe(200);
  };
  const cookie = await w.h.as('operator');
  const view = async () =>
    (
      await w.h.inject({ method: 'GET', url: `/api/devices/${pc}/agent`, cookie })
    ).json<DeviceAgentInfo>();
  const log = () => w.h.ports.logger.entries;
  return { w, s, pc, checkin, view, log };
}

describe('Wake-on-LAN readiness on the hub (FR-702.2)', () => {
  it('AC-702-02 the last check is stored and shown; settings turned back on are logged at info, ones that failed at warn, with the machine name', async () => {
    const { s, pc, checkin, view, log } = await world();
    const wol: NonNullable<AgentHealth['wol']> = {
      at: 1000,
      adapter: 'Intel(R) Ethernet Connection I219-LM',
      trigger: 'boot',
      items: [
        { item: 'magic_packet', state: 'fixed', detail: null },
        { item: 'device_wake', state: 'ok', detail: null },
        { item: 'advanced_eee', state: 'failed', detail: 'Acesso negado' },
      ],
    };
    await checkin({ wol });
    expect(readHealth(s.db, pc)?.wol).toEqual(wol);
    expect((await view()).health?.wol).toEqual(wol);
    const line = log().find((e) => e.msg?.startsWith('Wake-on-LAN settings'));
    expect(line).toMatchObject({ level: 'warn' });
    expect(line?.obj).toMatchObject({ device: 'LAB1-PC07', trigger: 'boot' });
    // Sent again unchanged (same time): stored, not logged twice; a later check without `wol` keeps it.
    await checkin({ wol });
    await checkin({});
    expect(log().filter((e) => e.msg?.startsWith('Wake-on-LAN settings'))).toHaveLength(1);
    expect(readHealth(s.db, pc)?.wol).toEqual(wol);
  });
});

describe('forced shutdowns and agent errors on the hub (FR-703.3, FR-704.2, FR-704.3)', () => {
  it('AC-703-03 forced shutdowns are appended (the last 10 kept), shown and logged at warn', async () => {
    const { s, pc, checkin, view, log } = await world();
    const esc = (attempt: number, at: number) => ({
      at,
      action: 'shutdown' as const,
      id: null,
      attempt,
      method: 'shutdown_force' as const,
      code: null,
      detail: null,
    });
    await checkin({ escalations: [esc(1, 1), esc(2, 2)] });
    await checkin({ escalations: Array.from({ length: 9 }, (_, i) => esc(1, 10 + i)) });
    const stored = readHealth(s.db, pc)?.escalations ?? [];
    expect(stored).toHaveLength(10);
    expect(stored[0]!.at).toBe(2);
    expect((await view()).health?.escalations).toHaveLength(10);
    const warns = log().filter(
      (e) => e.msg === 'agent forced the shutdown: the machine was still on',
    );
    expect(warns).toHaveLength(11);
    expect(warns[0]!.obj).toMatchObject({ device: 'LAB1-PC07', attempt: 1 });
    expect(warns[0]!.level).toBe('warn');
  });

  it('AC-704-02 agent errors reach the hub log with the machine name and stay on the device page (the last 20)', async () => {
    const { s, pc, checkin, view, log } = await world();
    const errors = Array.from({ length: 10 }, (_, i) => ({
      at: 100 + i,
      where: 'antivirus',
      message: `falha ${i}`,
    }));
    await checkin({ errors });
    await checkin({ errors: errors.map((e) => ({ ...e, at: e.at + 50 })) });
    await checkin({
      errors: [{ at: 999, where: 'desligar', message: 'shutdown.exe saiu com código 5' }],
    });
    const stored = readHealth(s.db, pc)?.errors ?? [];
    expect(stored).toHaveLength(20);
    expect(stored.at(-1)).toMatchObject({ where: 'desligar' });
    expect((await view()).health?.errors?.at(-1)?.message).toBe('shutdown.exe saiu com código 5');
    const lines = log().filter((e) => e.msg === 'agent error');
    expect(lines).toHaveLength(21);
    expect(lines.at(-1)?.obj).toMatchObject({
      device: 'LAB1-PC07',
      where: 'desligar',
      error: 'shutdown.exe saiu com código 5',
    });
    expect(lines.at(-1)?.level).toBe('warn');
  });

  it('AC-704-02 a report that failed is a warning in the hub log, once, with its detail', async () => {
    const { checkin, log } = await world();
    const report = {
      uuid: 'a1b2c3d4-0000-4000-8000-000000000777',
      occurrence: '6f1d2a3b-4c5d-5e6f-8a7b-000000000012',
      order: null,
      action: 'shutdown',
      outcome: 'failed',
      reason: 'error',
      plannedAt: 1,
      executedAt: null,
      postpones: 0,
      userLoggedOn: false,
      sessions: 0,
      wasAsleep: false,
      lateMinutes: null,
      nativeWarning: false,
      freezeState: 'none',
      detail: 'shutdown.exe saiu com código 5; CIM Win32Shutdown retornou 1',
    };
    await checkin(null, [report]);
    await checkin(null, [report]);
    const lines = log().filter((e) => e.msg === 'agent could not shut the machine down');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'warn' });
    expect(lines[0]!.obj).toMatchObject({ device: 'LAB1-PC07', detail: report.detail });
  });

  it('a 1.6.0-shaped health (no new fields) still works and keeps empty lists', async () => {
    const { s, pc, checkin, view } = await world();
    await checkin({});
    expect(readHealth(s.db, pc)).toMatchObject({ wol: null, escalations: [], errors: [] });
    expect((await view()).health).toMatchObject({ wol: null, escalations: [], errors: [] });
  });
});
