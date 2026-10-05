import net from 'node:net';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { mapLimit, TcpProber, tcpProbeOne } from '../src/adapters/tcp-prober';

// Listeners are closed and awaited before each test ends: a socket still closing when the worker
// exits has crashed the Windows worker natively (0xC0000409) in the full run.
async function listener(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((c) => c.end());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function closedPort(): Promise<number> {
  const l = await listener();
  await l.close();
  return l.port;
}

describe('TCP prober (FR-004.1, ADR-014)', () => {
  it('AC-004-02 a completed connection means online', async () => {
    const l = await listener();
    const r = await tcpProbeOne('127.0.0.1', l.port, 1000);
    expect(r).toMatchObject({ alive: true, via: 'tcp' });
    await l.close();
  });

  it('AC-004-03 a refused connection (RST) also means the host is on', async () => {
    const r = await tcpProbeOne('127.0.0.1', await closedPort(), 1000);
    expect(r).toMatchObject({ alive: true, via: 'tcp-refused' });
  });

  it('a timeout means no answer', async () => {
    const hanging = () => {
      const s = new net.Socket();
      return s; // never connects, never errors
    };
    const r = await tcpProbeOne('10.0.0.1', 445, 50, hanging);
    expect(r).toEqual({ alive: false, via: null, latencyMs: null });
  });

  it('probes several ports in parallel; the first positive wins', async () => {
    const l = await listener();
    const prober = new TcpProber();
    const res = await prober.probe(['127.0.0.1'], {
      icmpTimeoutMs: 0,
      tcpPorts: [await closedPort(), l.port],
      tcpTimeoutMs: 1000,
    });
    expect(res.get('127.0.0.1')?.alive).toBe(true);
    const none = await prober.probe(['127.0.0.1'], {
      icmpTimeoutMs: 0,
      tcpPorts: [],
      tcpTimeoutMs: 1000,
    });
    expect(none.get('127.0.0.1')?.alive).toBe(false);
    await l.close();
  });

  it('mapLimit never runs more than the limit at once and keeps order', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});
