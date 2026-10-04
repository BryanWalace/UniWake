import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planStagger, type StaggerDevice } from '../src/domain/stagger';

const devs = (n: number, roomId: number | null, start = 1): StaggerDevice[] =>
  Array.from({ length: n }, (_, i) => ({ deviceId: start + i, roomId }));

describe('stagger planning (FR-003.4)', () => {
  it('AC-003-10 room batch 5, delay 10 s, 12 devices → batches of 5, 5, 2 at 0, 10, 20 s', () => {
    const steps = planStagger(devs(12, 1), () => ({ batchSize: 5, delayMs: 10_000 }), 1000, 5000);
    expect(steps.map((s) => [s.atMs, s.deviceIds.length])).toEqual([
      [0, 5],
      [10_000, 5],
      [20_000, 2],
    ]);
    expect(steps.flatMap((s) => s.deviceIds)).toEqual(devs(12, 1).map((d) => d.deviceId));
  });

  it('rooms run in parallel with their own settings', () => {
    const settings = (room: number | null) =>
      room === 1 ? { batchSize: 2, delayMs: 3000 } : { batchSize: 10, delayMs: 5000 };
    const steps = planStagger([...devs(4, 1), ...devs(3, 2, 100)], settings, 1000, 5000);
    expect(steps).toEqual([
      { atMs: 0, deviceIds: [1, 2, 100, 101, 102] },
      { atMs: 3000, deviceIds: [3, 4] },
    ]);
  });

  it('AC-003-19 4 rooms × 20 devices, batch 10, cap 30: no step starts more than 30 devices', () => {
    const all = [1, 2, 3, 4].flatMap((r) => devs(20, r, r * 100));
    const steps = planStagger(all, () => ({ batchSize: 10, delayMs: 5000 }), 30, 5000);
    for (const s of steps) expect(s.deviceIds.length).toBeLessThanOrEqual(30);
    expect(steps.flatMap((s) => s.deviceIds).sort((a, b) => a - b)).toEqual(
      all.map((d) => d.deviceId).sort((a, b) => a - b),
    );
    expect(steps[0]?.deviceIds).toHaveLength(30);
  });

  it('delay 0 puts everything at t=0 unless the cap spreads it out', () => {
    const steps = planStagger(devs(70, null), () => ({ batchSize: 500, delayMs: 0 }), 30, 2000);
    expect(steps.map((s) => [s.atMs, s.deviceIds.length])).toEqual([
      [0, 30],
      [2000, 30],
      [4000, 10],
    ]);
    expect(planStagger([], () => ({ batchSize: 1, delayMs: 0 }), 30, 1000)).toEqual([]);
  });

  it('property: every device is planned exactly once and no step exceeds the cap', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }), { maxLength: 150 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 1, max: 60 }),
        (rooms, batchSize, delayMs, cap) => {
          const list = rooms.map((roomId, i) => ({ deviceId: i + 1, roomId }));
          const steps = planStagger(list, () => ({ batchSize, delayMs }), cap, 5000);
          const planned = steps.flatMap((s) => s.deviceIds).sort((a, b) => a - b);
          expect(planned).toEqual(list.map((d) => d.deviceId));
          for (const s of steps) expect(s.deviceIds.length).toBeLessThanOrEqual(cap);
          for (let i = 1; i < steps.length; i++)
            expect(steps[i]!.atMs).toBeGreaterThan(steps[i - 1]!.atMs);
        },
      ),
      { numRuns: 300 },
    );
  });
});
