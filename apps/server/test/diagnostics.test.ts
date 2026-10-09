import { changeLog } from '../src/db/sync/change-log';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceDiagnostics } from '@uniwake/shared';
import { type VerifiedResult, wakeStats } from '../src/domain/wake-stats';
import { iface } from './fakes/network-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

const ACTOR = { id: null, label: 'teste' };
const MIN = 60_000;

/** Oldest first, as they happened; wakeStats takes newest first. */
const history = (...results: ('acordou' | 'nao_respondeu')[]): VerifiedResult[] =>
  results.map((result, i) => ({ result, at: T0 + i * MIN })).reverse();

describe('wake statistics (FR-010)', () => {
  it('AC-010-01: 5 "acordou" then 3 "não respondeu" set "parou de acordar"; one "acordou" clears it', () => {
    const five = Array<'acordou'>(5).fill('acordou');
    const s = wakeStats(history(...five, 'nao_respondeu', 'nao_respondeu', 'nao_respondeu'));
    expect(s).toMatchObject({
      attempts: 8,
      successes: 5,
      successRate: 5 / 8,
      consecutiveFailures: 3,
      stoppedWaking: true,
      lastSuccessAt: T0 + 4 * MIN,
    });
    const back = wakeStats(
      history(...five, 'nao_respondeu', 'nao_respondeu', 'nao_respondeu', 'acordou'),
    );
    expect(back).toMatchObject({ consecutiveFailures: 0, stoppedWaking: false });
  });

  it('two failures are not enough, and a computer that never woke "nunca acordou", not "parou"', () => {
    expect(wakeStats(history('acordou', 'nao_respondeu', 'nao_respondeu')).stoppedWaking).toBe(
      false,
    );
    const never = wakeStats(history('nao_respondeu', 'nao_respondeu', 'nao_respondeu'));
    expect(never).toMatchObject({ stoppedWaking: false, lastSuccessAt: null, successRate: 0 });
    expect(wakeStats([])).toMatchObject({ attempts: 0, successRate: null });
  });

  it('the success rate covers the last 30 attempts', () => {
    const results = [
      ...Array<'nao_respondeu'>(10).fill('nao_respondeu'),
      ...Array<'acordou'>(30).fill('acordou'),
    ];
    expect(wakeStats(history(...results))).toMatchObject({ attempts: 30, successRate: 1 });
  });
});

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

async function setup(device: { ip?: string | null; mac?: string; roomId?: number } = {}) {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const pc = h.services.devices.create(
    { name: 'LAB3-PC40', mac: '00:AB:00:00:00:40', ip: '10.0.3.40', ...device },
    ACTOR,
  ).device;
  let job = 0;
  /** Records past wakes of the computer, oldest first. */
  const wakes = (...results: string[]) => {
    for (const result of results) {
      job++;
      const at = T0 - 100 * MIN + job * MIN;
      h.services.db.run(
        `INSERT INTO wake_jobs (id, source, target, state, created_at) VALUES (?, 'manual', '{}', 'concluido', ?)`,
        [job, at],
      );
      h.services.db.run(
        `INSERT INTO wake_job_devices (job_id, device_id, mac, result, sent_at, woke_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [job, pc.id, pc.mac, result, at, result === 'acordou' ? at + 30_000 : null],
      );
    }
  };
  const diag = async () =>
    (
      await h.inject({ url: `/api/devices/${pc.id}/diagnostics`, cookie })
    ).json<DeviceDiagnostics>();
  return { h, pc, wakes, diag, cookie };
}

describe('GET /api/devices/:id/diagnostics (FR-010)', () => {
  it('flags "parou de acordar" from the wake history, with the help page', async () => {
    const { wakes, diag } = await setup();
    wakes(
      'acordou',
      'acordou',
      'ja_estava_ligado',
      'nao_respondeu',
      'nao_respondeu',
      'nao_respondeu',
    );
    const d = await diag();
    expect(d.wake).toMatchObject({ attempts: 5, successes: 2, stoppedWaking: true });
    expect(d.problems.find((p) => p.code === 'parou_de_acordar')).toMatchObject({
      title: 'Parou de acordar',
      help: 'fast-startup',
    });
  });

  it('AC-010-02: an IP outside every controller interface is "Dispositivo em outra sub-rede" with the VLAN help', async () => {
    const { h, diag } = await setup({ ip: '10.0.9.5' });
    h.ports.interfaces.interfaces = [
      iface({ name: 'Ethernet', address: '10.0.3.15', prefixLength: 24, gateway: '10.0.3.1' }),
    ];
    const d = await diag();
    expect(d.network).toMatchObject({
      deviceIp: '10.0.9.5',
      sameSubnet: false,
      interfaces: [{ name: 'Ethernet', address: '10.0.3.15', prefixLength: 24 }],
    });
    expect(d.problems.find((p) => p.code === 'outra_subrede')).toMatchObject({
      title: 'Dispositivo em outra sub-rede',
      help: 'vlan-broadcast',
    });
    expect(d.problems.find((p) => p.code === 'outra_subrede')!.message).toContain('10.0.3.15/24');
  });

  it('a room with a directed broadcast covers the other subnet and adds its destination', async () => {
    const { h, diag, pc } = await setup({ ip: '10.0.9.5' });
    const lab9 = h.services.rooms.create({ name: 'Lab 9', directedBroadcast: '10.0.9.255' }, ACTOR);
    h.services.devices.update(pc.id, { roomId: lab9.id }, ACTOR);
    const d = await diag();
    expect(d.problems.map((p) => p.code)).not.toContain('outra_subrede');
    expect(d.network.destinations).toContainEqual({
      sourceIp: '10.0.3.15',
      destination: '10.0.9.255',
    });
  });

  it('reports the same subnet, other MACs, the last test-WoL and the preparation results', async () => {
    const { h, pc, diag } = await setup();
    h.services.db.run(
      `UPDATE devices SET other_macs = ?, prepared_at = ?, prepare_results = ? WHERE id = ?`,
      ['["00:AB:00:00:00:41"]', T0, '{"Fast Startup":"OK"}', pc.id],
    );
    changeLog(h.services.db).touch('device', pc.id);
    h.services.db.run(
      `INSERT INTO test_wol_runs (device_id, state, started_at, finished_at) VALUES (?, 'sucesso', ?, ?)`,
      [pc.id, T0, T0 + 2 * MIN],
    );
    const d = await diag();
    expect(d.network.sameSubnet).toBe(true);
    expect(d.otherMacs).toEqual(['00:AB:00:00:00:41']);
    expect(d.lastTestWol).toMatchObject({ state: 'sucesso', finishedAt: T0 + 2 * MIN });
    expect(d.prepare).toEqual({
      preparedAt: T0,
      enrolledAt: null,
      results: { 'Fast Startup': 'OK' },
    });
    expect(d.problems.map((p) => p.code)).toEqual(['nunca_respondeu']);
  });

  it('flags a Wi-Fi/virtual MAC and a hub with no interface to send from', async () => {
    const { h, diag } = await setup({ mac: '02:AB:00:00:00:40' });
    h.ports.interfaces.interfaces = [];
    const d = await diag();
    expect(d.network.sameSubnet).toBeNull();
    expect(d.problems.map((p) => p.code)).toEqual([
      'nunca_respondeu',
      'sem_interface',
      'mac_virtual',
    ]);
  });

  it('404 for an unknown device', async () => {
    const { h, cookie } = await setup();
    expect((await h.inject({ url: '/api/devices/999/diagnostics', cookie })).statusCode).toBe(404);
  });
});
