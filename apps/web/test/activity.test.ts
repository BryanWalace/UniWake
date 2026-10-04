import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import { IDLE_AFTER_MS, IDLE_HEADER, isUserIdle, noteActivity } from '../src/lib/activity';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('R-M4-01: requests sent while the user is inactive are marked', () => {
  it('adds X-UniWake-Idle after a minute without input and drops it on the next key or click', async () => {
    const seen: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get(IDLE_HEADER));
        return new Response('{}', { status: 200 });
      }),
    );
    const t0 = Date.now();
    noteActivity(t0);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(t0 + IDLE_AFTER_MS);
    await api.get('/api/dashboard');
    now.mockReturnValue(t0 + IDLE_AFTER_MS + 1);
    expect(isUserIdle()).toBe(true);
    await api.get('/api/dashboard');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await api.get('/api/dashboard');
    expect(seen).toEqual([null, '1', null]);
  });
});
