/**
 * TCP reachability probe (FR-004.1, ADR-014). A completed connection **or a refused one (RST)**
 * means the host is up; only a timeout means no answer. Ports are tried in parallel; the first
 * positive answer wins. Concurrency across addresses is bounded.
 */
import net from 'node:net';
import type { Prober, ProbeOptions, ProbeResult } from '../application/ports';

export type ConnectFn = (port: number, host: string) => net.Socket;

const defaultConnect: ConnectFn = (port, host) => net.connect({ port, host });

export function tcpProbeOne(
  address: string,
  port: number,
  timeoutMs: number,
  connect: ConnectFn = defaultConnect,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = connect(port, address);
    let done = false;
    const finish = (r: ProbeResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ alive: false, via: null, latencyMs: null }), timeoutMs);
    socket.once('connect', () =>
      finish({ alive: true, via: 'tcp', latencyMs: Math.round(performance.now() - started) }),
    );
    socket.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ECONNREFUSED') {
        finish({
          alive: true,
          via: 'tcp-refused',
          latencyMs: Math.round(performance.now() - started),
        });
      } else {
        finish({ alive: false, via: null, latencyMs: null });
      }
    });
  });
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export class TcpProber implements Prober {
  constructor(
    private readonly concurrency: () => number = () => 64,
    private readonly connect: ConnectFn = defaultConnect,
  ) {}

  async probe(addresses: readonly string[], opts: ProbeOptions): Promise<Map<string, ProbeResult>> {
    const results = await mapLimit(addresses, this.concurrency(), async (address) => {
      if (opts.tcpPorts.length === 0)
        return { alive: false, via: null, latencyMs: null } satisfies ProbeResult;
      const attempts = opts.tcpPorts.map((p) =>
        tcpProbeOne(address, p, opts.tcpTimeoutMs, this.connect),
      );
      // First positive answer wins; otherwise all timed out.
      return new Promise<ProbeResult>((resolve) => {
        let pending = attempts.length;
        for (const a of attempts) {
          void a.then((r) => {
            if (r.alive) resolve(r);
            else if (--pending === 0) resolve({ alive: false, via: null, latencyMs: null });
          });
        }
      });
    });
    return new Map(addresses.map((a, i) => [a, results[i]!]));
  }
}
