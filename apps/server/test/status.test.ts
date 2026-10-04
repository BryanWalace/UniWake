import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  nextStatus,
  type ProbeOutcome,
  type StatusState,
  UNKNOWN_STATE,
} from '../src/domain/status';

const alive = (latencyMs = 3): ProbeOutcome => ({ kind: 'alive', latencyMs });
const dead: ProbeOutcome = { kind: 'dead' };

function run(outcomes: ProbeOutcome[], offlineAfter = 2, start: StatusState = UNKNOWN_STATE) {
  let s = start;
  const changes: string[] = [];
  outcomes.forEach((o, i) => {
    const r = nextStatus(s, o, 1000 * (i + 1), offlineAfter);
    if (r.changed) changes.push(r.next.status);
    s = r.next;
  });
  return { s, changes };
}

describe('device status state machine (FR-004.1, ADR-014)', () => {
  it('AC-004-01 a reply means online with latency, last seen and online since', () => {
    const { s } = run([alive(7)]);
    expect(s).toMatchObject({
      status: 'online',
      latencyMs: 7,
      lastSeenAt: 1000,
      onlineSince: 1000,
      everOnline: true,
    });
  });

  it('AC-004-04 one failed sweep keeps an online device online; the second makes it offline', () => {
    const one = run([alive(), dead]);
    expect(one.s.status).toBe('online');
    const two = run([alive(), dead, dead]);
    expect(two.s).toMatchObject({
      status: 'offline',
      onlineSince: null,
      latencyMs: null,
      lastSeenAt: 1000,
    });
    expect(two.changes).toEqual(['online', 'offline']);
  });

  it('offline → online is immediate and onlineSince restarts', () => {
    const { s, changes } = run([alive(), dead, dead, alive()]);
    expect(s).toMatchObject({ status: 'online', onlineSince: 4000, consecutiveFailures: 0 });
    expect(changes).toEqual(['online', 'offline', 'online']);
  });

  it('a short blip (one lost sweep) produces no status change event', () => {
    const { changes, s } = run([alive(), alive(), dead, alive(), alive()]);
    expect(changes).toEqual(['online']);
    expect(s.onlineSince).toBe(1000);
  });

  it('from unknown, a single failed probe means offline; "nunca respondeu" while never seen', () => {
    const { s } = run([dead]);
    expect(s).toMatchObject({ status: 'offline', everOnline: false });
  });

  it('AC-004-05 no usable address → desconhecido', () => {
    const { s } = run([alive(), { kind: 'no_address' }]);
    expect(s).toMatchObject({ status: 'desconhecido', everOnline: true, latencyMs: null });
  });

  it('offlineAfter = 1 disables the debounce', () => {
    expect(run([alive(), dead], 1).s.status).toBe('offline');
  });

  it('property: status is online iff the last probe was alive or the device is in the debounce window', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 4 }),
        (bits, n) => {
          const { s } = run(
            bits.map((b) => (b ? alive() : dead)),
            n,
          );
          const lastAlive = bits.lastIndexOf(true);
          const failuresSince = bits.length - 1 - lastAlive;
          const expected = lastAlive >= 0 && failuresSince < n ? 'online' : 'offline';
          expect(s.status).toBe(expected);
          expect(s.everOnline).toBe(lastAlive >= 0);
        },
      ),
    );
  });
});
