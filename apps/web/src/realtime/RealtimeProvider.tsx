/**
 * Live updates (FR-004.4, ADR-020): one EventSource per logged-in session feeds the Query cache.
 * - `counters` patches the dashboard in place (AC-004-08: visible within 2 s);
 * - other events invalidate the affected queries, coalesced so a sweep is one refetch;
 * - every (re)connect refetches state, so nothing missed while offline stays stale (AC-004-14);
 * - `session.expired` logs the user out.
 */
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import type { Counters, Dashboard, StatusCounts } from '@uniwake/shared';
import { keys } from '../api/hooks';

export type RealtimeState = 'connecting' | 'open' | 'closed';

/** The subset of EventSource used here (tests pass a fake). */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void;
  close(): void;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

const CLOSED = 2;
const INVALIDATE_DELAY_MS = 300;
const RECONNECT_DELAYS_MS = [3_000, 10_000, 30_000];

const Ctx = createContext<RealtimeState>('closed');

/** 'open' while live updates flow; polling fallbacks can relax then. */
export function useRealtimeState(): RealtimeState {
  return useContext(Ctx);
}

/** The browser's EventSource, looked up when used (absent in some test environments). */
function browserFactory(): EventSourceFactory | null {
  return typeof EventSource === 'undefined'
    ? null
    : (url) => new EventSource(url, { withCredentials: true });
}

const zero = (): StatusCounts => ({ online: 0, offline: 0, desconhecido: 0, total: 0 });

export function applyCounters(d: Dashboard | undefined, c: Counters): Dashboard | undefined {
  if (!d) return d;
  const byRoom = new Map(c.rooms.map((r) => [r.roomId, r]));
  const strip = (x: StatusCounts): StatusCounts => ({
    online: x.online,
    offline: x.offline,
    desconhecido: x.desconhecido,
    total: x.total,
  });
  const none = byRoom.get(null);
  return {
    ...d,
    counters: strip(c.global),
    rooms: d.rooms.map((r) => {
      const x = byRoom.get(r.id);
      return { ...r, counts: x ? strip(x) : zero() };
    }),
    noRoom: none && none.total > 0 ? strip(none) : null,
  };
}

function parse<T>(ev: MessageEvent<string>): T | null {
  try {
    return JSON.parse(ev.data) as T;
  } catch {
    return null;
  }
}

export function RealtimeProvider({
  children,
  factory,
}: {
  children: ReactNode;
  factory?: EventSourceFactory;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<RealtimeState>(() =>
    (factory ?? browserFactory()) ? 'connecting' : 'closed',
  );

  useEffect(() => {
    const make = factory ?? browserFactory();
    if (!make) return;
    let es: EventSourceLike | null = null;
    let disposed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const pending = createInvalidator(qc);

    const connect = () => {
      if (disposed) return;
      const source = make('/api/events');
      es = source;
      setState('connecting');
      source.onopen = () => {
        attempt = 0;
        setState('open');
        pending.add(keys.dashboard, keys.devicesAll, ['jobs']);
      };
      source.onerror = () => {
        if (source.readyState !== CLOSED) {
          setState('connecting'); // the browser reconnects by itself
          return;
        }
        // Closed for good (e.g. 401): retry with backoff and re-check the session meanwhile.
        setState('closed');
        void qc.invalidateQueries({ queryKey: keys.me });
        const delay = RECONNECT_DELAYS_MS[Math.min(attempt++, RECONNECT_DELAYS_MS.length - 1)]!;
        retry = setTimeout(connect, delay);
      };
      source.addEventListener('counters', (ev) => {
        const c = parse<Counters>(ev);
        if (c) qc.setQueryData<Dashboard>(keys.dashboard, (d) => applyCounters(d, c));
      });
      source.addEventListener('device.status', () => pending.add(keys.devicesAll));
      for (const type of ['job.progress', 'job.device']) {
        source.addEventListener(type, (ev) => {
          const e = parse<{ jobId: number }>(ev);
          pending.add(e ? ['jobs', e.jobId] : ['jobs'], ['jobs', 'list'], keys.dashboard);
        });
      }
      for (const type of ['notice', 'scheduler']) {
        source.addEventListener(type, () => pending.add(keys.dashboard));
      }
      source.addEventListener('session.expired', () => {
        disposed = true;
        source.close();
        setState('closed');
        // Order matters: the auth observer must see null (RequireAuth then shows the login page);
        // other users' data must not survive on a shared lab PC.
        qc.setQueryData(keys.me, null);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      });
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      pending.dispose();
      es?.close();
    };
  }, [factory, qc]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

/** Coalesces invalidations: a burst of events becomes one refetch per query. */
function createInvalidator(qc: QueryClient) {
  const keysToInvalidate = new Map<string, readonly unknown[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    add(...ks: (readonly unknown[])[]) {
      for (const k of ks) keysToInvalidate.set(JSON.stringify(k), k);
      timer ??= setTimeout(() => {
        timer = null;
        const list = [...keysToInvalidate.values()];
        keysToInvalidate.clear();
        for (const k of list) void qc.invalidateQueries({ queryKey: k });
      }, INVALIDATE_DELAY_MS);
    },
    dispose() {
      if (timer) clearTimeout(timer);
    },
  };
}
