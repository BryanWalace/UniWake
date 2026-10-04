import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Counters, Dashboard } from '@uniwake/shared';
import { keys } from '../src/api/hooks';
import {
  applyCounters,
  type EventSourceLike,
  RealtimeProvider,
  useRealtimeState,
} from '../src/realtime/RealtimeProvider';
import { loggedInApi, renderApp } from './helpers';

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  private listeners = new Map<string, ((ev: MessageEvent<string>) => void)[]>();
  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, l: (ev: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    act(() => void this.onopen?.(new Event('open')));
  }
  emit(type: string, data: unknown) {
    act(() => {
      for (const l of this.listeners.get(type) ?? []) {
        l(new MessageEvent(type, { data: JSON.stringify(data) }));
      }
    });
  }
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0;
    act(() => void this.onerror?.(new Event('error')));
  }
  static latest() {
    return FakeEventSource.instances.at(-1)!;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeEventSource.instances = [];
});

const c = (online: number, offline: number) => ({
  online,
  offline,
  desconhecido: 0,
  total: online + offline,
});

const DASH: Dashboard = {
  counters: c(1, 2),
  rooms: [
    {
      id: 1,
      name: 'Lab 1',
      code: 'LAB1',
      block: null,
      floor: null,
      color: '#2563eb',
      counts: c(1, 2),
      lastAction: null,
    },
    {
      id: 2,
      name: 'Lab 2',
      code: 'LAB2',
      block: null,
      floor: null,
      color: '#16a34a',
      counts: c(0, 0),
      lastAction: null,
    },
  ],
  noRoom: null,
  tags: [],
  notices: [],
  demo: false,
  lastSweepAt: null,
};

describe('applyCounters', () => {
  it('patches global, per-room and "Sem sala" counts; rooms without devices drop to zero', () => {
    const counters: Counters = {
      global: c(5, 1),
      rooms: [
        { roomId: 1, ...c(3, 0) },
        { roomId: null, ...c(2, 1) },
      ],
    };
    const d = applyCounters(DASH, counters)!;
    expect(d.counters).toEqual(c(5, 1));
    expect(d.rooms.map((r) => r.counts)).toEqual([c(3, 0), c(0, 0)]);
    expect(d.noRoom).toEqual(c(2, 1));
    expect(applyCounters(undefined, counters)).toBeUndefined();
  });
});

describe('RealtimeProvider in the app (FR-004.4)', () => {
  function setup() {
    vi.stubGlobal('EventSource', FakeEventSource);
    return loggedInApi()
      .on('GET', '/api/dashboard', { body: DASH })
      .on('GET', '/api/rooms', { body: [] });
  }

  it('AC-004-08: a counters event updates the room card without a reload', async () => {
    setup();
    renderApp('/');
    const cards = await screen.findByRole('list', { name: 'Salas' });
    expect(within(cards).getByText('1/3')).toBeInTheDocument();
    const es = FakeEventSource.latest();
    expect(es.url).toBe('/api/events');
    es.open();
    expect(await screen.findByText('Atualização ao vivo.')).toBeInTheDocument();
    es.emit('counters', { global: c(3, 0), rooms: [{ roomId: 1, ...c(3, 0) }] });
    expect(await within(cards).findByText('3/3')).toBeInTheDocument();
  });

  it('AC-004-14: each (re)connect refetches the dashboard; a drop shows "Reconectando"', async () => {
    const api = setup();
    renderApp('/');
    await screen.findByRole('list', { name: 'Salas' });
    const fetches = () => api.calls.filter((x) => x.path === '/api/dashboard').length;
    const before = fetches();
    const es = FakeEventSource.latest();
    es.open();
    await waitFor(() => expect(fetches()).toBe(before + 1));
    es.fail(false);
    expect(await screen.findByText('Reconectando atualizações ao vivo…')).toBeInTheDocument();
    es.open();
    await waitFor(() => expect(fetches()).toBe(before + 2));
  });

  it('job events refresh that job; session.expired sends the user to the login page', async () => {
    const api = setup().on('GET', '/api/jobs', {
      body: { items: [], total: 0, page: 1, pageSize: 50 },
    });
    renderApp('/historico');
    await screen.findByRole('heading', { level: 1 });
    const es = FakeEventSource.latest();
    es.open();
    const listCalls = () => api.calls.filter((x) => x.path === '/api/jobs').length;
    const before = listCalls();
    es.emit('job.progress', { jobId: 9, state: 'enviando', summary: {} });
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));

    es.emit('session.expired', {});
    expect(es.closed).toBe(true);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });
});

describe('RealtimeProvider reconnects after the stream is closed', () => {
  it('backs off 3 s, 10 s, 30 s and re-checks the session', () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    function State() {
      return <p>{useRealtimeState()}</p>;
    }
    render(
      <QueryClientProvider client={qc}>
        <RealtimeProvider factory={(url) => new FakeEventSource(url)}>
          <State />
        </RealtimeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('connecting')).toBeInTheDocument();
    FakeEventSource.latest().fail(true);
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.me });
    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.latest().fail(true);
    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeEventSource.instances).toHaveLength(3);
    FakeEventSource.latest().open();
    expect(screen.getByText('open')).toBeInTheDocument();
  });
});
