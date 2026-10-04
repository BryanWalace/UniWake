import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, NETWORK_ERROR_MESSAGE } from '../src/api/client';

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('API client', () => {
  it('sends JSON with same-origin credentials and parses the response', async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    expect(await api.post('/api/x', { a: 1 }, { query: { page: 2, q: undefined } })).toEqual({
      ok: 1,
    });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/x?page=2');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"a":1}' });
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('turns API errors into ApiRequestError with the pt-BR message', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            code: 'DEVICE_MAC_DUPLICATE',
            message: 'O MAC já existe.',
            details: { id: 3 },
          }),
          {
            status: 409,
          },
        ),
    );
    const err = await api.get('/api/devices').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({
      status: 409,
      code: 'DEVICE_MAC_DUPLICATE',
      message: 'O MAC já existe.',
      details: { id: 3 },
    });
  });

  it('maps network failures and non-JSON errors to friendly messages; 204 → undefined', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.get('/api/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: NETWORK_ERROR_MESSAGE,
    });
    mockFetch(() => new Response('<html>502</html>', { status: 502 }));
    await expect(api.get('/api/x')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
    mockFetch(() => new Response(null, { status: 204 }));
    expect(await api.del('/api/x')).toBeUndefined();
  });
});
