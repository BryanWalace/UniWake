import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { routes } from '../src/router';

export type Handler = (body: unknown, url: URL) => { status?: number; body?: unknown } | undefined;

export interface FakeApi {
  calls: { method: string; path: string; body: unknown }[];
  on(method: string, path: string, handler: Handler | { status?: number; body?: unknown }): FakeApi;
}

/** Stubs `fetch` with an in-memory API keyed by "METHOD /path" (no network in tests). */
export function installFakeApi(): FakeApi {
  const handlers = new Map<string, Handler>();
  const api: FakeApi = {
    calls: [],
    on(method, path, handler) {
      handlers.set(`${method} ${path}`, typeof handler === 'function' ? handler : () => handler);
      return api;
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://127.0.0.1:47100');
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      api.calls.push({ method, path: url.pathname, body });
      const h = handlers.get(`${method} ${url.pathname}`);
      const r = h?.(body, url) ?? {
        status: 404,
        body: { code: 'NOT_FOUND', message: 'Não encontrado.' },
      };
      const status = r.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(r.body ?? {}), { status });
    }),
  );
  return api;
}

export const ADMIN = { id: 1, username: 'admin', role: 'admin' as const };

/** Fake API with an existing admin session. */
export function loggedInApi(): FakeApi {
  return installFakeApi()
    .on('GET', '/api/auth/setup-status', { body: { needsSetup: false } })
    .on('GET', '/api/auth/me', { body: ADMIN });
}

export function renderApp(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, qc };
}
