import type { FastifyInstance } from 'fastify';
import type { HttpServices } from '../context';
import { SECURITY_HEADERS } from '../security';
import { SESSION_COOKIE } from '../session-auth';
import { SseClient } from '../sse';

/** FR-004.4 live updates over SSE (ADR-020). */
export function eventsRoutes(app: FastifyInstance, s: HttpServices): void {
  const clients = new Set<SseClient>();

  // Open streams never go idle, so the server could not close while one is connected.
  app.addHook('preClose', async () => {
    for (const c of [...clients]) c.shutdown();
  });

  app.get('/api/events', { config: { auth: 'operator' } }, (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
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
        unsubscribe();
        req.log.debug({ reason }, 'sse client closed');
      },
    );
    const unsubscribe = s.events.subscribe((e) => client.send(e));
    clients.add(client);
    res.on('close', () => client.disconnected());
    client.open();
  });
}
