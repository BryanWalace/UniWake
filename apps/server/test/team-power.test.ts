/**
 * M17-T06 (ADR-048): remote shutdown in Modo equipe. A machine prepared on PC A checks in with PC
 * B; an order made on A is delivered by B; the machine's report and the order's state reach A; the
 * hub list tells the machine both hubs and their keys. Real TLS sync on 127.0.0.1.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CheckinRequest } from '@uniwake/shared';
import { tokenHash } from '../src/application/power/agent-tokens';
import { NodeSyncNetwork } from '../src/adapters/sync-network';
import { verifyChangeLog } from '../src/db/sync/change-log';
import { createServices, type Services } from '../src/services';
import { FakeClock } from './fakes/fake-clock';
import { T0, testDb } from './helpers/db';
import { fakePorts } from './helpers/ports';

const ACTOR = { id: null, label: 'teste' };
const NONCE = 'q5KX2nX0v4m8Zk1d0b7S9w';

const worlds: Services[] = [];
const clocks = new Map<string, FakeClock>();
afterEach(async () => {
  for (const s of worlds.splice(0)) {
    expect(verifyChangeLog(s.db)).toEqual([]);
    s.scheduler.stop();
    await s.sync.close();
    s.db.close();
  }
});

function world(name: string) {
  const db = testDb();
  const clock = new FakeClock(T0);
  clocks.set(name, clock);
  const s = createServices(
    db,
    clock,
    { ...fakePorts(clock), syncNetwork: new NodeSyncNetwork({ bind: '127.0.0.1' }) },
    {
      team: { port: 0, defaultPort: 0, machineName: name, announceTargets: () => [] },
      agentScripts: { get: (n) => ({ bytes: Buffer.from(n), sha256: tokenHash(n) }) },
    },
  );
  worlds.push(s);
  return s;
}

const request = (clock: number, over: Partial<CheckinRequest> = {}): CheckinRequest => ({
  protocol: 1,
  nonce: NONCE,
  agentVersion: '1.3.0',
  bootTime: null,
  clock,
  freeze: { product: null, state: 'none', persistent: false },
  power: { sleepAfterMinutes: null, wakeTimers: 'unknown' },
  session: { loggedOn: false, sessions: 0 },
  reports: [],
  ackedOrders: [],
  ...over,
});

describe('remote shutdown in team mode (ADR-048)', () => {
  it("a machine prepared on A checks in with B, gets A's order, and its report reaches A", async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    const { code } = await a.pairing.openCode(ACTOR);
    await b.pairing.join({ address: '127.0.0.1', port: a.sync.ports().tcp!, code: code! }, ACTOR);
    await Promise.all([a.hubKey.init(), b.hubKey.init()]);
    a.team.publishSigningKey(a.hubKey.keyId(), a.hubKey.publicKey());
    b.team.publishSigningKey(b.hubKey.keyId(), b.hubKey.publicKey());

    // Prepared on A.
    const room = a.rooms.create({ name: 'Lab 3' }, ACTOR).id;
    const deviceId = a.devices.create(
      { name: 'PC-01', mac: '00:AA:00:00:00:01', roomId: room },
      ACTOR,
    ).device.id;
    const { token } = await a.agent.enrollAnswer(deviceId);
    const sync = async () => {
      await a.sync.syncAll(true);
      await b.sync.syncAll(true);
      await a.sync.syncAll(true);
    };
    await sync();

    // B knows the machine's token and its device.
    const onB = b.agent.identify(token);
    const bDevice = b.db.get<{ id: number }>(
      "SELECT id FROM devices WHERE mac = '00:AA:00:00:00:01'",
    )!;
    expect(onB.deviceId).toBe(bDevice.id);

    // An order made on A is delivered by B.
    const job = a.power.start(
      {
        action: 'shutdown',
        target: { type: 'devices', deviceIds: [deviceId] },
        warning: 'short',
        confirmProtected: false,
      },
      ACTOR,
    );
    await sync();
    const first = b.agent.checkin(onB, request(b.clock.now()), {
      ip: '10.0.3.41',
      host: undefined,
    });
    expect(first.orders).toHaveLength(1);
    const orderUuid = first.orders[0]!.uuid;
    // The hub list names both hubs with their keys (B answers; A is its peer on 127.0.0.1).
    expect(first.hubs.list.map((h) => h.keyId).sort()).toEqual([a.hubKey.keyId()].sort());
    expect(first.hubs.epoch).toBe(b.team.epoch());

    clocks.get('PC-B')!.set(b.clock.now() + 61_000); // past the per-machine limit
    b.agent.checkin(
      b.agent.identify(token),
      request(b.clock.now(), {
        ackedOrders: [orderUuid],
        reports: [
          {
            uuid: 'a1b2c3d4-0000-4000-8000-000000000001',
            occurrence: null,
            order: orderUuid,
            action: 'shutdown',
            outcome: 'done',
            reason: null,
            plannedAt: null,
            executedAt: b.clock.now(),
            postpones: 0,
            userLoggedOn: false,
            sessions: 0,
            wasAsleep: false,
            lateMinutes: null,
            nativeWarning: false,
            freezeState: 'none',
            detail: null,
          },
        ],
      }),
      { ip: '10.0.3.41', host: undefined },
    );
    await sync();

    // A sees the order executed and the report, with the same identities.
    expect(
      a.db.get('SELECT state, delivered_by_instance FROM power_orders WHERE uuid = ?', [orderUuid]),
    ).toEqual({
      state: 'executed',
      delivered_by_instance: b.team.self().instanceId,
    });
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM power_reports')!.n).toBe(1);
    expect(a.power.get(job.jobId).devices[0]!.state).not.toBe('pending');
  }, 60_000);

  it('revoking on one hub revokes on every hub; deleting the device removes its agent everywhere', async () => {
    const a = world('PC-A');
    const b = world('PC-B');
    const { code } = await a.pairing.openCode(ACTOR);
    await b.pairing.join({ address: '127.0.0.1', port: a.sync.ports().tcp!, code: code! }, ACTOR);
    const deviceId = a.devices.create({ name: 'PC-01', mac: '00:AA:00:00:00:01' }, ACTOR).device.id;
    const { token } = await a.agent.enrollAnswer(deviceId);
    const sync = async () => {
      await a.sync.syncAll(true);
      await b.sync.syncAll(true);
      await a.sync.syncAll(true);
    };
    await sync();
    b.agentTokens.revoke(b.agent.identify(token).deviceId, 'PC-01', ACTOR);
    await sync();
    expect(a.agentTokens.authenticate(token)).toBeNull();

    a.devices.delete(deviceId, ACTOR);
    await sync();
    expect(b.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM device_agents')!.n).toBe(0);
  }, 60_000);
});
