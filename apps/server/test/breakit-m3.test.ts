/** M3-D break-it pass (tasks.md checklist) for the wake engine. */
import { afterEach, describe, expect, it } from 'vitest';
import type { WakeJob } from '@uniwake/shared';
import { apiHarness, type ApiHarness } from './helpers/api';

const ACTOR = { id: null, label: 'teste' };
const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) {
    for (let t = 0; t < 3 * 3_600_000 && h.services.runner.activeCount > 0; t += 5000)
      await h.clock.advanceAsync(5000);
    await h.close();
  }
});

async function setup(devices = 3) {
  const h = await apiHarness();
  hs.push(h);
  const cookie = await h.as('operator');
  const room = h.services.rooms.create({ name: 'Lab' }, ACTOR).id;
  for (let i = 0; i < devices; i++) {
    const hex = i.toString(16).padStart(4, '0');
    h.services.devices.create(
      {
        name: `PC-${i}`,
        mac: `02:00:00:00:${hex.slice(0, 2)}:${hex.slice(2)}`,
        roomId: room,
        ip: `10.0.${(i >> 8) & 255}.${i & 255}`,
      },
      ACTOR,
    );
  }
  const wake = (body: object = { target: { type: 'rooms', roomIds: [room] } }) =>
    h.inject({ method: 'POST', url: '/api/wake', cookie, payload: body });
  const job = async (id: number) =>
    (await h.inject({ url: `/api/jobs/${id}`, cookie })).json<{ job: WakeJob }>().job;
  return { h, cookie, room, wake, job };
}

describe('M3-D: concurrency', () => {
  it('two simultaneous wakes of the same room: one starts, the other is told it is running', async () => {
    const { wake } = await setup();
    const [a, b] = await Promise.all([wake(), wake()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
  });
});

describe('M3-D: clock jumps during verification', () => {
  it('a backwards clock jump does not keep the job (and its devices) locked beyond the window', async () => {
    const { h, wake, job } = await setup();
    const { jobId } = (await wake()).json<{ jobId: number }>();
    await h.clock.advanceAsync(5000); // verifying, window = 5 min
    h.clock.jump(-3_600_000); // NTP correction: clock goes back 1 h
    // Only ~5 min of real (timer) time should be needed to finish.
    for (let t = 0; t < 6 * 60_000 && h.services.runner.activeCount > 0; t += 1000)
      await h.clock.advanceAsync(1000);
    expect((await job(jobId)).state).toBe('concluido');
  });

  it('a forward clock jump ends verification early but cleanly', async () => {
    const { h, wake, job } = await setup();
    const { jobId } = (await wake()).json<{ jobId: number }>();
    await h.clock.advanceAsync(5000);
    h.clock.jump(3_600_000);
    for (let t = 0; t < 60_000 && h.services.runner.activeCount > 0; t += 1000)
      await h.clock.advanceAsync(1000);
    expect((await job(jobId)).state).toBe('concluido');
  });
});

describe('M3-D: port failures', () => {
  it('a transient error reading interfaces does not fail a manual wake', async () => {
    const { h, wake, job } = await setup();
    h.ports.interfaces.faults.failNext(1);
    const { jobId } = (await wake()).json<{ jobId: number }>();
    for (let t = 0; t < 10 * 60_000 && h.services.runner.activeCount > 0; t += 1000)
      await h.clock.advanceAsync(1000);
    const j = await job(jobId);
    expect(j.state).toBe('concluido');
    expect(h.ports.sender.sent.length).toBeGreaterThan(0);
  });

  it('the prober failing during verification does not crash the job', async () => {
    const { h, wake, job } = await setup();
    h.ports.prober.faults.failWhen(() => true);
    const { jobId } = (await wake()).json<{ jobId: number }>();
    for (let t = 0; t < 10 * 60_000 && h.services.runner.activeCount > 0; t += 1000)
      await h.clock.advanceAsync(1000);
    expect((await job(jobId)).summary.noResponse).toBe(3);
  });
});

describe('M3-D: malformed requests', () => {
  it('rejects unknown target types, huge id lists, bad stagger and negative confirmations', async () => {
    const { wake } = await setup();
    for (const body of [
      { target: { type: 'macs', macs: ['00:11:22:33:44:55'] } },
      { target: { type: 'devices', deviceIds: Array.from({ length: 2001 }, (_, i) => i + 1) } },
      { target: { type: 'all' }, stagger: { batchSize: 0, batchDelaySeconds: 5 } },
      { target: { type: 'all' }, confirm: { count: -1 } },
      { target: { type: 'rooms', roomIds: ['1'] } },
    ]) {
      expect((await wake(body)).statusCode, JSON.stringify(body).slice(0, 60)).toBe(422);
    }
  });
});

describe('M3-D: scale (NFR-01)', () => {
  it('a 500-device job sends and logs every packet quickly in CPU time', async () => {
    const { h, room, wake, job } = await setup(500);
    h.services.settings.update({ 'wake.confirmThreshold': 1000 }, null);
    const started = performance.now();
    const { jobId } = (await wake({ target: { type: 'rooms', roomIds: [room] } })).json<{
      jobId: number;
    }>();
    for (let t = 0; t < 30 * 60_000 && h.services.runner.activeCount > 0; t += 5000)
      await h.clock.advanceAsync(5000);
    const cpuMs = performance.now() - started;
    expect((await job(jobId)).state).toBe('concluido');
    // 500 devices × 2 destinations × 2 ports × 3 repeats
    expect(h.ports.sender.sent).toHaveLength(6000);
    expect(
      h.services.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM packet_log WHERE job_id = ?', [
        jobId,
      ])?.n,
    ).toBe(6000);
    expect(cpuMs).toBeLessThan(20_000);
  });
});
