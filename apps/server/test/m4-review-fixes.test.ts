import { afterEach, describe, expect, it } from 'vitest';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

describe('R-M4-01: an unattended panel does not keep its session alive', () => {
  it('requests marked X-UniWake-Idle do not count as activity; the session still idles out', async () => {
    const h = await apiHarness();
    hs.push(h);
    const cookie = await h.as('operator');
    const lastSeen = () =>
      h.services.db.get<{ t: number }>('SELECT last_seen_at AS t FROM sessions')!.t;
    const idleGet = () =>
      h.inject({ url: '/api/dashboard', cookie, headers: { 'x-uniwake-idle': '1' } });

    const before = lastSeen();
    h.clock.advance(5 * 60_000);
    expect((await idleGet()).statusCode).toBe(200);
    expect(lastSeen()).toBe(before); // polling while idle

    expect((await h.inject({ url: '/api/dashboard', cookie })).statusCode).toBe(200);
    expect(lastSeen()).toBe(h.clock.now()); // the user did something

    // 12 h of nothing but background polls every minute: logged out.
    for (let m = 0; m < 12 * 60 + 2; m++) {
      h.clock.advance(60_000);
      const r = await idleGet();
      if (r.statusCode === 401) {
        expect(m).toBeGreaterThan(11 * 60);
        return;
      }
    }
    expect.unreachable('the session never idled out');
  });
});
