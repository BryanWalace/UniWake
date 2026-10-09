/**
 * M14-T04 (owner request, item 3): two real hubs on this machine — own data folders, own ephemeral
 * ports, loopback only — pair, sync rooms/devices/schedules both ways, resolve a conflict and run a
 * schedule on exactly one of them. Demo mode: wakes are dry runs (no packet leaves the machine).
 * The clocks are fake (to place the schedule); the network is real TCP/TLS/UDP on 127.0.0.1.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { DevSecretProtector } from '../src/adapters/secret-protector';
import { CONFIG_DEFAULTS, type Config } from '../src/config';
import { verifyChangeLog } from '../src/db/sync/change-log';
import { createHub, type Hub } from '../src/hub';
import { FakeClock } from './fakes/fake-clock';

const ACTOR = { id: null, label: 'teste' };
/** Monday 5 Oct 2026, local São Paulo (UTC−3). */
const sp = (h: number, m = 0, s = 0) => Date.UTC(2026, 9, 5, h + 3, m, s);

const hubs: Hub[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const h of hubs.splice(0)) await h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Pc {
  hub: Hub;
  clock: FakeClock;
  name: string;
}

async function pc(name: string, others: () => Pc[]): Promise<Pc> {
  const dir = mkdtempSync(join(tmpdir(), `uniwake-team-${name}-`));
  dirs.push(dir);
  const clock = new FakeClock(sp(6, 30));
  const config: Config = {
    ...CONFIG_DEFAULTS,
    dataDir: dir,
    demo: true,
    demoSeed: false,
    panelPort: 0,
    agentPort: 0,
    agentBind: '127.0.0.1',
    syncPort: 0,
  };
  const hub = await createHub({
    config,
    clock,
    logger: pino({ level: 'silent' }),
    syncBind: '127.0.0.1',
    secrets: new DevSecretProtector(),
    machineName: name,
    // Announcements go to the other hubs' UDP ports on loopback (never a real broadcast).
    teamAnnounceTargets: () =>
      others()
        .map((o) => o.hub.services.sync.ports().udp)
        .filter((p): p is number => p !== null && p > 0)
        .map((port) => ({ host: '127.0.0.1', port })),
  });
  hubs.push(hub);
  await hub.start();
  return { hub, clock, name };
}

async function until(cond: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const s = (p: Pc) => p.hub.services;
const roomNames = (p: Pc) =>
  s(p)
    .rooms.list()
    .map((r) => r.name);
const portOf = (p: Pc) => s(p).sync.ports().tcp!;
const jobs = (p: Pc) => p.hub.db.all<{ id: number }>('SELECT id FROM wake_jobs');

async function pair(inviter: Pc, joiner: Pc, confirm?: string) {
  const { code } = await s(inviter).pairing.openCode(ACTOR);
  await s(joiner).pairing.join(
    { address: '127.0.0.1', port: portOf(inviter), code: code!, confirm },
    ACTOR,
  );
}

describe('Modo equipe with two instances on one machine', () => {
  it('AC-201-03, AC-201-06, AC-202-01, AC-203-01, AC-204-01: pair, sync both ways, resolve a conflict, one executor', async () => {
    const all: Pc[] = [];
    const a = await pc('PC-A', () => all.filter((x) => x !== a));
    const b = await pc('PC-B', () => all.filter((x) => x !== b));
    all.push(a, b);

    // A holds the inventory; B has something of its own that the team's data replaces.
    const lab = s(a).rooms.create({ name: 'Lab 1' }, ACTOR).id;
    const prof = s(a).tags.create({ name: 'professor' }, ACTOR).id;
    s(a).devices.create(
      { name: 'PC-01', mac: '00:AA:00:00:00:01', ip: '10.0.3.11', roomId: lab, tagIds: [prof] },
      ACTOR,
    );
    s(a).schedules.create(
      {
        name: 'Manhã',
        weekdays: 31,
        timeLocal: '06:50',
        target: { type: 'rooms', roomIds: [lab] },
      },
      ACTOR,
    );
    s(b).rooms.create({ name: 'Sala do B' }, ACTOR);

    // AC-201-02: a wrong code fails, nothing is stored, the attempt counts.
    const { code } = await s(a).pairing.openCode(ACTOR);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(
      s(b).pairing.join(
        { address: '127.0.0.1', port: portOf(a), code: wrong, confirm: 'SUBSTITUIR' },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'TEAM_PAIRING_WRONG_CODE' });
    expect(s(b).team.inTeam()).toBe(false);
    expect(s(a).pairing.view().attemptsLeft).toBe(4);
    // AC-201-06: B has data: without the typed confirmation nothing happens.
    await expect(
      s(b).pairing.join({ address: '127.0.0.1', port: portOf(a), code: code! }, ACTOR),
    ).rejects.toMatchObject({ code: 'TEAM_REPLACE_CONFIRM' });
    expect(roomNames(b)).toEqual(['Sala do B']);

    // AC-201-03: the right code pairs; B adopts the team's data.
    await s(b).pairing.join(
      { address: '127.0.0.1', port: portOf(a), code: code!, confirm: 'SUBSTITUIR' },
      ACTOR,
    );
    expect(s(b).team.teamId()).toBe(s(a).team.teamId());
    expect(roomNames(b)).toEqual(['Lab 1']);
    expect(
      s(b)
        .schedules.list()
        .map((x) => x.name),
    ).toEqual(['Manhã']);
    await until(() => s(a).team.members().length === 2, 'A to list B');
    expect(
      s(b)
        .team.members()
        .map((m) => m.name)
        .sort(),
    ).toEqual(['PC-A', 'PC-B']);
    expect(s(a).pairing.view().open).toBe(false); // single use

    // AC-202-01: B → A as well (B pokes A after a local change; A pulls).
    s(b).devices.create(
      { name: 'PC-02', mac: '00:AA:00:00:00:02', roomId: s(b).rooms.list()[0]!.id },
      ACTOR,
    );
    await s(b).sync.syncAll(true);
    await until(
      () =>
        s(a).devices.list({ q: 'PC-02', page: 1, pageSize: 5 }) &&
        (s(a).devices.list({ q: 'PC-02', page: 1, pageSize: 5 }) as { total: number }).total === 1,
      'PC-02 on A',
    );

    // AC-203-01: the same room renamed differently on both while apart.
    const labOnB = s(b).rooms.list()[0]!.id;
    s(a).rooms.update(lab, { name: 'Lab Azul' }, ACTOR);
    s(b).rooms.update(labOnB, { name: 'Lab Verde' }, ACTOR);
    s(b).rooms.update(labOnB, { name: 'Lab Verde B' }, ACTOR);
    await s(a).sync.syncAll(false);
    await s(b).sync.syncAll(false);
    await s(a).sync.syncAll(false);
    expect(roomNames(a)).toEqual(roomNames(b));
    const conflicts = [...s(a).team.conflicts(), ...s(b).team.conflicts()];
    expect(conflicts.some((c) => c.kind === 'concurrent')).toBe(true);

    // AC-204-01: both PCs on at 06:50 → exactly one wake job across both.
    for (const p of all) p.clock.set(sp(6, 49));
    for (const p of all) s(p).scheduler.tick();
    // Fresh "seen" marks on both sides (announcements do this every 15 s in real life).
    for (const p of all) p.clock.set(sp(6, 49, 30));
    await s(a).sync.syncAll(true);
    await s(b).sync.syncAll(true);
    for (const p of all) p.clock.set(sp(6, 50, 5));
    const ran = all.map((p) => s(p).scheduler.tick().ran);
    expect(ran.reduce((x, y) => x + y, 0)).toBe(1);
    await s(a).sync.syncAll(true);
    await s(b).sync.syncAll(true);
    for (const p of all) p.clock.set(sp(6, 53));
    for (const p of all) s(p).scheduler.tick(); // the deferred PC sees the record and stands down
    expect(jobs(a).length + jobs(b).length).toBe(1);
    const runOf = (p: Pc) =>
      p.hub.db.get<{ uuid: string; by: string }>(
        'SELECT uuid, claimed_by_instance AS by FROM schedule_runs',
      );
    expect(runOf(a)).toEqual(runOf(b));
    const elected = [s(a).team.self().instanceId, s(b).team.self().instanceId].sort()[0];
    expect(runOf(a)!.by).toBe(elected);

    for (const p of all) expect(verifyChangeLog(p.hub.db)).toEqual([]);
  }, 60_000);

  it('AC-204-02: with the elected PC off, the other runs the schedule on time', async () => {
    const all: Pc[] = [];
    const a = await pc('PC-A', () => all.filter((x) => x !== a));
    const b = await pc('PC-B', () => all.filter((x) => x !== b));
    all.push(a, b);
    const lab = s(a).rooms.create({ name: 'Lab 1' }, ACTOR).id;
    s(a).devices.create(
      { name: 'PC-01', mac: '00:AA:00:00:00:01', ip: '10.0.3.11', roomId: lab },
      ACTOR,
    );
    s(a).schedules.create(
      {
        name: 'Manhã',
        weekdays: 31,
        timeLocal: '06:50',
        target: { type: 'rooms', roomIds: [lab] },
      },
      ACTOR,
    );
    await pair(a, b);
    // Whoever would be elected is switched off; the survivor last saw it at 06:30.
    const [first, second] = [a, b].sort((x, y) =>
      s(x).team.self().instanceId < s(y).team.self().instanceId ? -1 : 1,
    );
    await first!.hub.stop();
    hubs.splice(hubs.indexOf(first!.hub), 1);
    second!.clock.set(sp(6, 49));
    s(second!).scheduler.tick();
    second!.clock.set(sp(6, 50, 5));
    expect(s(second!).scheduler.tick().ran).toBe(1);
  }, 60_000);

  it('AC-201-05: revoking a PC rotates the key; a PC that was off gets it later; the revoked one is shut out', async () => {
    const all: Pc[] = [];
    const a = await pc('PC-A', () => all.filter((x) => x !== a));
    const b = await pc('PC-B', () => all.filter((x) => x !== b));
    const c = await pc('PC-C', () => all.filter((x) => x !== c));
    all.push(a, b, c);
    s(a).rooms.create({ name: 'Lab 1' }, ACTOR);
    await pair(a, b);
    await pair(a, c);
    await s(a).sync.syncAll(true);
    await until(
      () => s(b).team.members().length === 3 && s(c).team.members().length === 3,
      'members everywhere',
    );
    const epoch = s(a).team.epoch()!;

    // B is "off" (not reachable) while A revokes C.
    const bPort = portOf(b);
    s(a).team.updatePeer({ instanceId: s(b).team.self().instanceId, port: 1 });
    await s(a).team.revoke(s(c).team.self().instanceId, ACTOR);
    await s(a).sync.pushRekey();
    expect(s(a).team.epoch()).toBe(epoch + 1);

    // B comes back: it contacts A with the old key and receives the new one.
    s(a).team.updatePeer({ instanceId: s(b).team.self().instanceId, port: bPort });
    await s(b).sync.pullFrom(s(a).team.self().instanceId);
    await until(() => s(b).team.epoch() === epoch + 1, 'B to receive the new key');
    s(a).rooms.create({ name: 'Lab 2' }, ACTOR);
    await s(b).sync.pullFrom(s(a).team.self().instanceId);
    expect(roomNames(b)).toEqual(['Lab 1', 'Lab 2']);
    expect(
      s(b)
        .team.members()
        .find((m) => m.name === 'PC-C')!.revokedAt,
    ).not.toBeNull();

    // AC-202-04: the revoked PC can no longer pull: it is told it was removed, leaves the team and
    // keeps its data (even when nobody else could tell it).
    await s(c).sync.pullFrom(s(a).team.self().instanceId);
    expect(roomNames(c)).toEqual(['Lab 1']);
    expect(s(c).team.inTeam()).toBe(false);
    expect(
      s(c)
        .notices.list()
        .some((n) => n.type === 'team_revoked'),
    ).toBe(true);
  }, 60_000);
});
