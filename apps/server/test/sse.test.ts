import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/http/session-auth';
import {
  formatSse,
  SSE_HEARTBEAT_MS,
  SseClient,
  type SseCloseReason,
  type SseSink,
} from '../src/http/sse';
import { FakeClock } from './fakes/fake-clock';
import { apiHarness, type ApiHarness } from './helpers/api';
import { T0 } from './helpers/db';

class MemorySink implements SseSink {
  chunks: string[] = [];
  ended = false;
  bufferedBytes = 0;
  write(chunk: string) {
    this.chunks.push(chunk);
  }
  end() {
    this.ended = true;
  }
  get text() {
    return this.chunks.join('');
  }
}

function client(sessionValid = () => true) {
  const clock = new FakeClock(T0);
  const sink = new MemorySink();
  const closed: SseCloseReason[] = [];
  const c = new SseClient(sink, { clock, sessionValid, maxBufferBytes: 100 }, (r) =>
    closed.push(r),
  );
  c.open();
  return { clock, sink, closed, c };
}

describe('SseClient', () => {
  it('opens with a retry hint and forwards bus events as named SSE events', () => {
    const { sink, c } = client();
    expect(sink.text).toBe('retry: 3000\n: connected\n\n');
    c.send(
      formatSse('device.status', { deviceId: 7, status: 'online', latencyMs: 3, lastSeenAt: T0 }),
    );
    c.send(formatSse('counters', {}));
    expect(sink.chunks.slice(1)).toEqual([
      `event: device.status\ndata: {"deviceId":7,"status":"online","latencyMs":3,"lastSeenAt":${T0}}\n\n`,
      'event: counters\ndata: {}\n\n',
    ]);
  });

  it('sends a heartbeat comment every 20 s', () => {
    const { clock, sink } = client();
    clock.advance(SSE_HEARTBEAT_MS - 1);
    expect(sink.chunks).toHaveLength(1);
    clock.advance(1);
    clock.advance(SSE_HEARTBEAT_MS);
    expect(sink.chunks.slice(1)).toEqual([': ping\n\n', ': ping\n\n']);
  });

  it('emits session.expired and closes when the session is no longer valid', () => {
    let valid = true;
    const { clock, sink, closed, c } = client(() => valid);
    clock.advance(SSE_HEARTBEAT_MS);
    valid = false;
    clock.advance(SSE_HEARTBEAT_MS);
    expect(sink.chunks.at(-1)).toBe('event: session.expired\ndata: {}\n\n');
    expect(sink.ended).toBe(true);
    expect(closed).toEqual(['session_expired']);
    expect(clock.pendingTimers).toBe(0);
    c.send(formatSse('counters', {}));
    expect(sink.chunks.at(-1)).toBe('event: session.expired\ndata: {}\n\n');
  });

  it('drops a client whose unsent buffer exceeds the cap', () => {
    const { sink, closed, clock, c } = client();
    sink.bufferedBytes = 101;
    c.send(formatSse('counters', {}));
    expect(closed).toEqual(['slow_client']);
    expect(sink.ended).toBe(true);
    expect(sink.chunks).toHaveLength(1);
    expect(clock.pendingTimers).toBe(0);
  });

  it('a client disconnect stops the heartbeat without ending twice', () => {
    const { sink, closed, clock, c } = client();
    c.disconnected();
    c.shutdown();
    expect(closed).toEqual(['client']);
    expect(sink.ended).toBe(false);
    expect(clock.pendingTimers).toBe(0);
  });
});

describe('GET /api/events', () => {
  const hs: ApiHarness[] = [];
  afterEach(async () => {
    for (const h of hs.splice(0)) await h.close();
  });

  async function listen() {
    const h = await apiHarness();
    hs.push(h);
    await h.app.listen({ host: '127.0.0.1', port: 0 });
    const port = (h.app.server.address() as AddressInfo).port;
    return { h, base: `http://127.0.0.1:${port}` };
  }

  /** Reads the stream until `pattern` shows up (or fails after 3 s of real time). */
  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: string) {
    const dec = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 3000;
    while (!text.includes(pattern)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${pattern}; got ${text}`);
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
    return text;
  }

  it('AC-004-14: requires a session', async () => {
    const h = await apiHarness();
    hs.push(h);
    const r = await h.inject({ url: '/api/events' });
    expect(r.statusCode).toBe(401);
    expect(r.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
  });

  it('AC-004-14: streams bus events, ends with session.expired after logout, and does not touch the session', async () => {
    const { h, base } = await listen();
    const cookie = await h.as('operator');
    const token = cookie.slice(SESSION_COOKIE.length + 1);
    const seenBefore = h.services.db.get<{ last_seen_at: number }>(
      'SELECT last_seen_at FROM sessions',
    )!;

    const res = await fetch(`${base}/api/events`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const reader = res.body!.getReader();
    await readUntil(reader, ': connected');

    h.services.events.publish({
      type: 'job.progress',
      jobId: 4,
      state: 'enviando',
      summary: {} as never,
    });
    expect(await readUntil(reader, '"jobId":4')).toContain('event: job.progress');

    h.clock.advance(5 * 60_000); // heartbeats: session still valid, but never refreshed
    expect(
      h.services.db.get<{ last_seen_at: number }>('SELECT last_seen_at FROM sessions'),
    ).toEqual(seenBefore);

    h.services.auth.logout(token, { ip: '127.0.0.1', remoteAddress: null, userAgent: null });
    h.clock.advance(SSE_HEARTBEAT_MS);
    const tail = await readUntil(reader, 'session.expired');
    expect(tail).toContain('event: session.expired');
    expect((await reader.read()).done).toBe(true);
  });

  it('server close ends open streams instead of hanging', async () => {
    const { h, base } = await listen();
    const cookie = await h.as('operator');
    const res = await fetch(`${base}/api/events`, { headers: { cookie } });
    const reader = res.body!.getReader();
    await readUntil(reader, ': connected');
    await h.app.close();
    expect((await reader.read()).done).toBe(true);
  });
});
