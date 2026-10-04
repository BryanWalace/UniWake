import type { FastifyInstance } from 'fastify';
import type { HubEvent } from '../../application/events-bus';
import type { HttpServices } from '../context';
import { SECURITY_HEADERS } from '../security';
import { SESSION_COOKIE } from '../session-auth';
import { formatSse, SseClient } from '../sse';

/** FR-004.4 live updates over SSE (ADR-020). */
export function eventsRoutes(app: FastifyInstance, s: HttpServices): void {
  const clients = new Set<SseClient>();

  /** Each event is serialized once for every client; `counters` carries the fresh counts. */
  const encode = (e: HubEvent): string => {
    if (e.type === 'counters') return formatSse('counters', s.dashboard.counters());
    const { type, ...data } = e;
    return formatSse(type, data);
  };
  const unsubscribe = s.events.subscribe((e) => {
    if (clients.size === 0) return;
    const chunk = encode(e);
    for (const c of clients) c.send(chunk);
  });

  // Open streams never go idle, so the server could not close while one is connected.
  app.addHook('preClose', async () => {
    for (const c of [...clients]) c.shutdown();
  });
  app.addHook('onClose', async () => unsubscribe());

  app.get('/api/events', { config: { auth: 'operator' } }, (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      // One long-lived response per connection: when it ends, the socket closes with it instead of
      // idling in a keep-alive pool until server shutdown destroys it.
      connection: 'close',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();

    const client = new SseClient(
      {
        write: (chunk) => void res.write(chunk),
        get bufferedBytes() {
          return res.writableLength;
        },
        end: () => res.end(),
      },
      {
        clock: s.clock,
        // Not touching the session: an open dashboard alone must not defeat the idle timeout.
        sessionValid: () => s.auth.authenticate(token, { touch: false }) !== null,
      },
      (reason) => {
        clients.delete(client);
        req.log.debug({ reason }, 'sse client closed');
      },
    );
    clients.add(client);
    res.on('close', () => client.disconnected());
    client.open();
  });
}
