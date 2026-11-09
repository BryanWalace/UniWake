/**
 * v1.7.0 "Ligar que insiste" (spec §6f, FR-701, ADR-063): retry rounds for the machines that did
 * not answer, a unicast to their last IP, and awake neighbours asked (through their signed check-in
 * answer) to broadcast the packet in their own network. Fake sender and fake agents only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CheckinAnswer } from '@uniwake/shared';
import { pickPeers, relayCapable } from '../src/application/wake/relay-service';
import { unicastRoutes } from '../src/domain/network';
import { iface } from './fakes/network-fakes';
import { agentWorld, type AgentWorld } from './helpers/fake-agent';

const ACTOR = { id: null, label: 'teste' };
const worlds: AgentWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) {
    for (let t = 0; t < 3_600_000 && w.h.services.runner.activeCount > 0; t += 5000) {
      await w.h.clock.advanceAsync(5000);
    }
    await w.close();
  }
});

async function world() {
  const w = await agentWorld();
  worlds.push(w);
  const s = w.h.services;
  const room = s.rooms.create({ name: 'Lab 1' }, ACTOR).id;
  const other = s.rooms.create({ name: 'Lab 2' }, ACTOR).id;
  const target = s.devices.create(
    { name: 'LAB1-PC01', mac: '00:AA:00:00:00:01', roomId: room, ip: '10.0.3.50' },
    ACTOR,
  ).device;
  const mk = (name: string, mac: string, roomId: number) =>
    s.devices.create({ name, mac, roomId }, ACTOR).device.id;
  const peer = mk('LAB1-PC02', '00:AA:00:00:00:02', room);
  const oldPeer = mk('LAB1-PC03', '00:AA:00:00:00:03', room);
  const far = mk('LAB2-PC01', '00:AA:00:00:00:04', other);
  const tokens = new Map([peer, oldPeer, far].map((id) => [id, s.agentTokens.issue(id)]));
  const checkin = async (id: number, version: string, ip: string, health?: unknown) => {
    const r = await w.listener.inject({
      method: 'POST',
      url: '/agent/v1/checkin',
      remoteAddress: ip,
      headers: { host: '10.0.3.15:47101', authorization: `Bearer ${tokens.get(id)!}` },
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
    return r.json<CheckinAnswer>();
  };
  const wake = () =>
    s.wake.start(
      { target: { type: 'devices', deviceIds: [target.id] }, onlyOffline: false },
      ACTOR,
      { source: 'manual', preConfirmed: true },
    ).jobId;
  return { w, s, target, peer, oldPeer, far, checkin, wake };
}

const sentTo = (w: AgentWorld, mac: string) =>
  w.h.ports.sender.sent.filter((p) => p.payload.length === 102 && macOf(p.payload) === mac);
const macOf = (b: Uint8Array) =>
  [...b.slice(6, 12)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');

describe('wake that insists (FR-701)', () => {
  it('AC-701-01 a machine that does not answer gets 3 retry rounds a minute apart, with a unicast to its last IP from round 1, all in the packet log', async () => {
    const { w, s, target, wake } = await world();
    const t0 = w.h.clock.now();
    const jobId = wake();
    for (let t = 0; t < 10 * 60_000 && s.runner.activeCount > 0; t += 1000) {
      await w.h.clock.advanceAsync(1000);
    }
    const packets = s.wake.packets(jobId);
    const rounds = [...new Set(packets.map((p) => p.round))].sort();
    expect(rounds).toEqual([0, 1, 2, 3]);
    // Round 0: broadcasts only (2 destinations × 2 ports × 3 repeats); later rounds add the unicast.
    expect(packets.filter((p) => p.round === 0)).toHaveLength(12);
    expect(packets.filter((p) => p.round === 0 && p.dstIp === '10.0.3.50')).toHaveLength(0);
    for (const r of [1, 2, 3]) {
      expect(packets.filter((p) => p.round === r && p.dstIp === '10.0.3.50')).toHaveLength(6);
      const first = packets.find((p) => p.round === r)!;
      expect(Math.round((first.at - t0) / 60_000)).toBe(r);
    }
    expect(sentTo(w, target.mac).length).toBe(12 + 3 * 18);
    expect(s.wake.job(jobId).devices[0]!.result).toBe('nao_respondeu');
  });

  it('AC-701-01 a machine that wakes after round 1 gets no further round', async () => {
    const { w, s, wake } = await world();
    const jobId = wake();
    await w.h.clock.advanceAsync(75_000);
    w.h.ports.prober.setAlive('10.0.3.50');
    for (let t = 0; t < 10 * 60_000 && s.runner.activeCount > 0; t += 1000) {
      await w.h.clock.advanceAsync(1000);
    }
    expect(Math.max(...s.wake.packets(jobId).map((p) => p.round ?? 0))).toBe(1);
    expect(s.wake.job(jobId).devices[0]!.result).toBe('acordou');
  });

  it('AC-701-02 the unicast goes from the interface on the machine subnet, or through the gateway interface; never to APIPA or loopback', () => {
    const lan = iface({ address: '10.0.3.15', gateway: '10.0.3.1' });
    const other = iface({ name: 'Ethernet 2', address: '192.168.9.2', gateway: null });
    expect(unicastRoutes([other, lan], '10.0.3.50')).toEqual([
      { sourceIp: '10.0.3.15', destination: '10.0.3.50' },
    ]);
    expect(unicastRoutes([other, lan], '10.0.8.7')).toEqual([
      { sourceIp: '10.0.3.15', destination: '10.0.8.7' },
    ]);
    expect(unicastRoutes([lan], '169.254.1.1')).toEqual([]);
    expect(unicastRoutes([lan], '127.0.0.1')).toEqual([]);
    expect(unicastRoutes([lan], null)).toEqual([]);
    expect(unicastRoutes([lan], 'x')).toEqual([]);
  });

  it('AC-701-03 round 1 asks an awake neighbour with agent 1.8.0 of the same room; its signed answer carries the MAC once; its report lands in the packet log', async () => {
    const { w, s, target, peer, oldPeer, far, checkin, wake } = await world();
    await checkin(peer, '1.8.0', '10.0.3.41');
    await checkin(oldPeer, '1.7.0', '10.0.3.42');
    await checkin(far, '1.8.0', '10.0.9.43');
    const jobId = wake();
    await w.h.clock.advanceAsync(30_000);
    expect((await checkin(peer, '1.8.0', '10.0.3.41')).wake).toBeUndefined();
    await w.h.clock.advanceAsync(35_000); // round 1 at +60 s
    const a = await checkin(peer, '1.8.0', '10.0.3.41');
    expect(a.wake).toEqual({ ports: [9, 7], macs: [target.mac] });
    // Delivered once; the old agent and the PC of another room/network are never asked.
    expect((await checkin(peer, '1.8.0', '10.0.3.41')).wake).toBeUndefined();
    expect((await checkin(oldPeer, '1.7.0', '10.0.3.42')).wake).toBeUndefined();
    expect((await checkin(far, '1.8.0', '10.0.9.43')).wake).toBeUndefined();

    const at = w.h.clock.now();
    const health = {
      installLevel: 4,
      update: null,
      repairs: [],
      antivirus: null,
      relays: [{ mac: target.mac, at, sent: 6, error: null }],
    };
    await checkin(peer, '1.8.0', '10.0.3.41', health);
    await checkin(peer, '1.8.0', '10.0.3.41', health); // re-sent after a lost answer
    const relayed = s.wake.packets(jobId).filter((p) => p.via);
    expect(relayed).toEqual([
      expect.objectContaining({
        via: 'LAB1-PC02',
        srcIp: '10.0.3.41',
        round: 1,
        outcome: 'sent',
        mac: target.mac,
      }),
    ]);
    expect(w.h.ports.logger.text()).toContain('a neighbour sent the magic packet');
  });

  it('AC-701-03 no neighbour is asked in dry-run or with "wake.peerRelay" off', async () => {
    const { w, s, peer, checkin, wake } = await world();
    await checkin(peer, '1.8.0', '10.0.3.41');
    s.settings.update({ 'wake.dryRun': true }, null);
    wake();
    await w.h.clock.advanceAsync(65_000);
    expect((await checkin(peer, '1.8.0', '10.0.3.41')).wake).toBeUndefined();
    expect(w.h.ports.logger.text()).toContain('dry-run: neighbours are not asked');
    for (let t = 0; t < 10 * 60_000 && s.runner.activeCount > 0; t += 1000) {
      await w.h.clock.advanceAsync(1000);
    }
    s.settings.update({ 'wake.dryRun': false, 'wake.peerRelay': false }, null);
    wake();
    await w.h.clock.advanceAsync(65_000);
    expect((await checkin(peer, '1.8.0', '10.0.3.41')).wake).toBeUndefined();
  });

  it('peers: same room first, then the same /24, freshest first, at most 3; versions below 1.8.0 never', () => {
    const p = (
      deviceId: number,
      roomId: number | null,
      ip: string | null,
      v: string,
      seenAt = 0,
    ) => ({
      deviceId,
      name: `P${deviceId}`,
      roomId,
      ip,
      agentVersion: v,
      seenAt,
    });
    const target = { deviceId: 1, mac: '00:AA:00:00:00:01', ip: '10.0.3.50', roomId: 7 };
    const peers = [
      p(1, 7, '10.0.3.50', '1.8.0'),
      p(2, 7, '10.0.3.2', '1.8.0', 5),
      p(3, 7, '10.0.3.3', '1.8.0', 9),
      p(4, null, '10.0.3.4', '1.8.0'),
      p(5, 8, '10.0.4.5', '1.9.1'),
      p(6, 7, '10.0.3.6', '1.7.9'),
      p(7, 9, '10.0.3.7', '2.0.0'),
    ];
    expect(pickPeers(target, peers).map((x) => x.deviceId)).toEqual([3, 2, 4]);
    expect(relayCapable('1.8.0-dev.3')).toBe(true);
    expect(relayCapable('1.10.0')).toBe(true);
    expect(relayCapable('1.7.0')).toBe(false);
    expect(relayCapable(null)).toBe(false);
    expect(relayCapable('abc')).toBe(false);
  });
});

describe('wake log lines (FR-704.2)', () => {
  it('AC-704-02 a finished wake job logs, at warn, the machines that did not turn on and the send errors', async () => {
    const { w, s, wake } = await world();
    s.settings.update({ 'wake.retryRounds': 1 }, null);
    wake();
    for (let t = 0; t < 10 * 60_000 && s.runner.activeCount > 0; t += 1000) {
      await w.h.clock.advanceAsync(1000);
    }
    const line = w.h.ports.logger.entries.find(
      (e) => e.msg === 'wake job finished with machines that did not turn on',
    );
    expect(line?.level).toBe('warn');
    expect(line?.obj).toMatchObject({ noResponseNames: ['LAB1-PC01'], retryRounds: 1 });
    expect(w.h.ports.logger.text()).toContain(
      'wake retry round for machines that did not answer yet',
    );
  });
});
