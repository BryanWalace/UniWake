/**
 * Server-Sent Events stream for the panel (ADR-020, plan §6.3). One `SseClient` per connection:
 * forwards bus events, sends a heartbeat comment every 20 s, re-checks the session on each
 * heartbeat (emitting `session.expired` before closing) and drops clients whose unsent buffer
 * exceeds the cap (they reconnect and refetch).
 */
import type { Clock, TimerHandle } from '../application/ports';

export const SSE_HEARTBEAT_MS = 20_000;
export const SSE_MAX_BUFFER_BYTES = 1024 * 1024;
/** Browser reconnect delay suggested to EventSource. */
export const SSE_RETRY_MS = 3_000;

export interface SseSink {
  write(chunk: string): void;
  /** Bytes queued but not yet flushed to the socket. */
  readonly bufferedBytes: number;
  end(): void;
}

export interface SseClientOptions {
  clock: Clock;
  sessionValid: () => boolean;
  heartbeatMs?: number;
  maxBufferBytes?: number;
}

export type SseCloseReason = 'client' | 'session_expired' | 'slow_client' | 'shutdown';

export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class SseClient {
  private timer: TimerHandle | null = null;
  private closedWith: SseCloseReason | null = null;

  constructor(
    private readonly sink: SseSink,
    private readonly o: SseClientOptions,
    private readonly onClosed: (reason: SseCloseReason) => void = () => undefined,
  ) {}

  get closed(): SseCloseReason | null {
    return this.closedWith;
  }

  open(): void {
    this.sink.write(`retry: ${SSE_RETRY_MS}\n: connected\n\n`);
    this.arm();
  }

  /** Sends one pre-formatted SSE chunk (see `formatSse`). */
  send(chunk: string): void {
    if (this.closedWith) return;
    this.write(chunk);
  }

  /** The socket went away (browser closed the tab or EventSource reconnects). */
  disconnected(): void {
    this.close('client', false);
  }

  /** Hub shutdown: end the stream so the HTTP server can close. */
  shutdown(): void {
    this.close('shutdown', true);
  }

  private arm() {
    this.timer = this.o.clock.setTimeout(
      () => this.heartbeat(),
      this.o.heartbeatMs ?? SSE_HEARTBEAT_MS,
    );
  }

  private heartbeat() {
    this.timer = null;
    if (this.closedWith) return;
    if (!this.o.sessionValid()) {
      this.write(formatSse('session.expired', {}));
      this.close('session_expired', true);
      return;
    }
    this.write(': ping\n\n');
    if (!this.closedWith) this.arm();
  }

  private write(chunk: string) {
    if (this.sink.bufferedBytes > (this.o.maxBufferBytes ?? SSE_MAX_BUFFER_BYTES)) {
      this.close('slow_client', true);
      return;
    }
    this.sink.write(chunk);
  }

  private close(reason: SseCloseReason, endSink: boolean) {
    if (this.closedWith) return;
    this.closedWith = reason;
    if (this.timer !== null) this.o.clock.clearTimeout(this.timer);
    this.timer = null;
    if (endSink) this.sink.end();
    this.onClosed(reason);
  }
}
