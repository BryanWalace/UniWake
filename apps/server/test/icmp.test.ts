import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type ChildHandle,
  CompositeProber,
  parsePingOutput,
  PingExeIcmp,
  powershellSpawner,
  PsHelperIcmp,
} from '../src/adapters/icmp';
import { SystemClock } from '../src/adapters/system-clock';
import type { TcpProber } from '../src/adapters/tcp-prober';
import { FakeClock, flushMicrotasks } from './fakes/fake-clock';
import { FakeProcessRunner, MemoryLogger } from './fakes/system-fakes';

type Mode = 'answer' | 'hang' | 'exit' | 'garbage';

/** Scripted stand-in for the PowerShell helper process. */
function fakeHelper(
  alive: Set<string>,
  mode: () => Mode = () => 'answer',
  announceReady: () => boolean = () => true,
) {
  const spawned: {
    requests: { id: number; targets: string[]; timeout: number }[];
    killed: boolean;
  }[] = [];
  const spawner = (): ChildHandle => {
    const rec = {
      requests: [] as { id: number; targets: string[]; timeout: number }[],
      killed: false,
    };
    spawned.push(rec);
    let lineCb: (l: string) => void = () => undefined;
    let exitCb: () => void = () => undefined;
    return {
      write(line) {
        const req = JSON.parse(line) as { id: number; targets: string[]; timeout: number };
        rec.requests.push(req);
        const m = mode();
        if (m === 'hang') return;
        if (m === 'exit') return queueMicrotask(() => exitCb());
        queueMicrotask(() => {
          if (m === 'garbage') lineCb('WARNING: something happened');
          lineCb(
            JSON.stringify({
              id: req.id,
              results: req.targets.map((t) => ({
                t,
                s: alive.has(t) ? 'Success' : 'TimedOut',
                ms: alive.has(t) ? 2 : 0,
              })),
            }),
          );
        });
      },
      onLine: (cb) => {
        lineCb = cb;
        if (announceReady()) queueMicrotask(() => lineCb('{"ready":true}'));
      },
      onExit: (cb) => (exitCb = cb),
      kill: () => (rec.killed = true),
    };
  };
  return { spawner, spawned };
}

describe('PowerShell ICMP helper adapter (ADR-019)', () => {
  it('micro-batches pings issued together into one request', async () => {
    const clock = new FakeClock(0);
    const { spawner, spawned } = fakeHelper(new Set(['10.0.0.1', '10.0.0.3']));
    const icmp = new PsHelperIcmp(spawner, clock, new MemoryLogger());
    const pending = ['10.0.0.1', '10.0.0.2', '10.0.0.3'].map((a) => icmp.ping(a, 1000));
    await clock.advanceAsync(5);
    const results = await Promise.all(pending);
    expect(results.map((r) => r.alive)).toEqual([true, false, true]);
    expect(results[0]?.latencyMs).toBe(2);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.requests).toEqual([
      { id: 1, targets: ['10.0.0.1', '10.0.0.2', '10.0.0.3'], timeout: 1000 },
    ]);
  });

  it('splits batches larger than maxBatch and ignores non-JSON output', async () => {
    const clock = new FakeClock(0);
    const { spawner, spawned } = fakeHelper(new Set(), () => 'garbage');
    const icmp = new PsHelperIcmp(spawner, clock, new MemoryLogger(), { maxBatch: 2 });
    const pending = ['a', 'b', 'c'].map((a) => icmp.ping(a, 500));
    await clock.advanceAsync(5);
    expect((await Promise.all(pending)).every((r) => !r.alive)).toBe(true);
    expect(spawned[0]?.requests.map((r) => r.targets)).toEqual([['a', 'b'], ['c']]);
  });

  it('a request that misses its deadline resolves as no answer and restarts the helper', async () => {
    const clock = new FakeClock(0);
    let mode: Mode = 'hang';
    const { spawner, spawned } = fakeHelper(new Set(['10.0.0.1']), () => mode);
    const icmp = new PsHelperIcmp(spawner, clock, new MemoryLogger());
    const p = icmp.ping('10.0.0.1', 1000);
    await clock.advanceAsync(5 + 4000);
    expect(await p).toEqual({ alive: false, latencyMs: null });
    expect(spawned[0]?.killed).toBe(true);
    mode = 'answer';
    const again = icmp.ping('10.0.0.1', 1000);
    await clock.advanceAsync(5);
    expect((await again).alive).toBe(true);
    expect(spawned).toHaveLength(2);
  });

  it('three restarts in 5 minutes mark the helper unhealthy for 30 minutes', async () => {
    const clock = new FakeClock(0);
    const { spawner } = fakeHelper(new Set(), () => 'exit');
    const icmp = new PsHelperIcmp(spawner, clock, new MemoryLogger());
    for (let i = 0; i < 3; i++) {
      const p = icmp.ping('10.0.0.1', 1000);
      await clock.advanceAsync(5);
      await flushMicrotasks();
      expect((await p).alive).toBe(false);
    }
    expect(icmp.healthy).toBe(false);
    clock.advance(30 * 60_000);
    expect(icmp.healthy).toBe(true);
  });

  it('a helper that cannot start answers "no reply" instead of throwing', async () => {
    const clock = new FakeClock(0);
    const icmp = new PsHelperIcmp(
      () => {
        throw new Error('ENOENT powershell.exe');
      },
      clock,
      new MemoryLogger(),
    );
    const p = icmp.ping('10.0.0.1', 1000);
    await clock.advanceAsync(5);
    expect((await p).alive).toBe(false);
  });
});

describe('ping.exe fallback (ADR-019)', () => {
  const PT_OK =
    'Disparando 10.0.3.21 com 32 bytes de dados:\r\nResposta de 10.0.3.21: bytes=32 tempo=3ms TTL=128\r\n';
  const PT_LT = 'Resposta de 127.0.0.1: bytes=32 tempo<1ms TTL=128\r\n';
  const EN_OK = 'Reply from 10.0.3.21: bytes=32 time=12ms TTL=127\r\n';
  const PT_UNREACH = 'Resposta de 10.0.3.1: Host de destino inacessível.\r\n';
  const EN_TIMEOUT = 'Request timed out.\r\n';

  it('parses localized output by TTL= and exit code only', () => {
    expect(parsePingOutput(0, PT_OK)).toEqual({ alive: true, latencyMs: 3 });
    expect(parsePingOutput(0, PT_LT)).toEqual({ alive: true, latencyMs: 1 });
    expect(parsePingOutput(0, EN_OK)).toEqual({ alive: true, latencyMs: 12 });
    // Windows exits 0 for "destination unreachable" replies from a router: not alive.
    expect(parsePingOutput(0, PT_UNREACH)).toEqual({ alive: false, latencyMs: null });
    expect(parsePingOutput(1, EN_TIMEOUT)).toEqual({ alive: false, latencyMs: null });
  });

  it('runs System32\\ping.exe with one echo and the timeout', async () => {
    const runner = new FakeProcessRunner().on('ping.exe', {
      exitCode: 0,
      stdout: PT_OK,
      stderr: '',
    });
    const ping = new PingExeIcmp(runner, 'C:\\Windows');
    expect(await ping.ping('10.0.3.21', 800)).toEqual({ alive: true, latencyMs: 3 });
    expect(runner.calls[0]).toMatchObject({
      file: 'C:\\Windows\\System32\\ping.exe',
      args: ['-n', '1', '-w', '800', '10.0.3.21'],
    });
    expect(await new PingExeIcmp(new FakeProcessRunner()).ping('x', 100)).toEqual({
      alive: false,
      latencyMs: null,
    });
  });
});

describe('composite prober (FR-004.1)', () => {
  const opts = { icmpTimeoutMs: 1000, tcpPorts: [445], tcpTimeoutMs: 800 };
  const tcpThatSays = (alive: boolean) =>
    ({
      probe: (addresses: readonly string[]) =>
        Promise.resolve(
          new Map(
            addresses.map((a) => [
              a,
              alive
                ? { alive: true, via: 'tcp-refused' as const, latencyMs: 4 }
                : { alive: false, via: null, latencyMs: null },
            ]),
          ),
        ),
    }) as unknown as TcpProber;

  it('AC-004-01 uses ICMP first; AC-004-03 falls back to TCP when there is no echo reply', async () => {
    const clock = new FakeClock(0);
    const { spawner } = fakeHelper(new Set(['10.0.0.1']));
    const helper = new PsHelperIcmp(spawner, clock, new MemoryLogger(), { batchWindowMs: 0 });
    const prober = new CompositeProber(tcpThatSays(true), helper, null);
    const pending = prober.probe(['10.0.0.1', '10.0.0.2'], opts);
    await clock.advanceAsync(1);
    const r = await pending;
    expect(r.get('10.0.0.1')).toEqual({ alive: true, via: 'icmp', latencyMs: 2 });
    expect(r.get('10.0.0.2')).toEqual({ alive: true, via: 'tcp-refused', latencyMs: 4 });
    expect(prober.icmpMode).toBe('helper');
  });

  it('uses the ping.exe fallback when the helper is unhealthy; TCP only when there is no ICMP at all', async () => {
    const fallback = { ping: () => Promise.resolve({ alive: true, latencyMs: 9 }) };
    const unhealthy = { healthy: false } as unknown as PsHelperIcmp;
    const viaFallback = new CompositeProber(tcpThatSays(false), unhealthy, fallback);
    expect(viaFallback.icmpMode).toBe('fallback');
    expect((await viaFallback.probe(['10.0.0.9'], opts)).get('10.0.0.9')).toEqual({
      alive: true,
      via: 'icmp',
      latencyMs: 9,
    });
    const tcpOnly = new CompositeProber(tcpThatSays(false), null, null);
    expect(tcpOnly.icmpMode).toBe('none');
    expect((await tcpOnly.probe(['10.0.0.9'], opts)).get('10.0.0.9')?.alive).toBe(false);
  });
});

const HELPER = join(import.meta.dirname, '..', 'helper', 'probe-helper.ps1');

describe.skipIf(process.platform !== 'win32')(
  'probe-helper.ps1 contract on Windows (loopback only)',
  () => {
    it('answers real pings to 127.0.0.1 through PowerShell', async () => {
      const icmp = new PsHelperIcmp(
        powershellSpawner(HELPER),
        new SystemClock(),
        new MemoryLogger(),
      );
      try {
        const r = await icmp.ping('127.0.0.1', 1000);
        expect(r.alive).toBe(true);
        const [a, b] = await Promise.all([
          icmp.ping('127.0.0.2', 1000),
          icmp.ping('127.0.0.3', 1000),
        ]);
        expect(a.alive && b.alive).toBe(true);
      } finally {
        icmp.close();
      }
    }, 30_000);

    it('soak: 10 000 loopback pings without losing answers (handle leaks would show here)', async () => {
      const icmp = new PsHelperIcmp(
        powershellSpawner(HELPER),
        new SystemClock(),
        new MemoryLogger(),
      );
      try {
        const all = await Promise.all(
          Array.from({ length: 10_000 }, (_, i) =>
            icmp.ping(`127.0.${(i >> 8) & 255}.${i & 255 || 1}`, 1000),
          ),
        );
        expect(all.filter((r) => r.alive)).toHaveLength(10_000);
        expect(icmp.healthy).toBe(true);
      } finally {
        icmp.close();
      }
    }, 120_000);
  },
);

describe('helper queueing (regression: deadlines expired while requests waited in the helper)', () => {
  it('requests are sent one at a time, so slow batches never time out while queued', async () => {
    const clock = new FakeClock(0);
    const writes: number[] = [];
    let lineCb: (l: string) => void = () => undefined;
    const spawner = (): ChildHandle => ({
      write(line) {
        const req = JSON.parse(line) as { id: number; targets: string[] };
        writes.push(clock.now());
        // each batch takes 900 ms in the helper
        clock.setTimeout(
          () =>
            lineCb(
              JSON.stringify({
                id: req.id,
                results: req.targets.map((t) => ({ t, s: 'Success', ms: 1 })),
              }),
            ),
          900,
        );
      },
      onLine: (cb) => {
        lineCb = cb;
        queueMicrotask(() => cb('{"ready":true}'));
      },
      onExit: () => undefined,
      kill: () => undefined,
    });
    const icmp = new PsHelperIcmp(spawner, clock, new MemoryLogger(), { maxBatch: 10 });
    const pending = Array.from({ length: 60 }, (_, i) => icmp.ping(`10.0.0.${i}`, 1000));
    for (let t = 0; t < 10_000; t += 100) await clock.advanceAsync(100);
    const results = await Promise.all(pending);
    expect(results.every((r) => r.alive)).toBe(true); // 6 batches × 0.9 s > 4 s deadline, still fine
    expect(writes).toHaveLength(6);
    expect(icmp.healthy).toBe(true);
  });

  it('waits for the ready line: a slow cold start is not a missed deadline (CI regression)', async () => {
    const clock = new FakeClock(0);
    let lineCb: (l: string) => void = () => undefined;
    const writes: number[] = [];
    let spawns = 0;
    const spawner = (): ChildHandle => {
      spawns++;
      return {
        write(line) {
          const req = JSON.parse(line) as { id: number; targets: string[] };
          writes.push(clock.now());
          queueMicrotask(() =>
            lineCb(
              JSON.stringify({
                id: req.id,
                results: req.targets.map((t) => ({ t, s: 'Success', ms: 1 })),
              }),
            ),
          );
        },
        onLine: (cb) => {
          lineCb = cb;
          clock.setTimeout(() => cb('{"ready":true}'), 8_000); // PowerShell takes 8 s to start
        },
        onExit: () => undefined,
        kill: () => undefined,
      };
    };
    const logger = new MemoryLogger();
    const icmp = new PsHelperIcmp(spawner, clock, logger);
    const pending = icmp.ping('127.0.0.1', 1000);
    for (let t = 0; t < 9_000; t += 100) await clock.advanceAsync(100);
    expect(await pending).toEqual({ alive: true, latencyMs: 1 });
    expect(writes).toEqual([8_000 + 5]);
    expect(spawns).toBe(1);
    expect(logger.entries.filter((e) => e.level === 'warn')).toEqual([]);
  });

  it('restarts a helper that never becomes ready and answers the waiting batch as dead', async () => {
    const clock = new FakeClock(0);
    const { spawner, spawned } = fakeHelper(
      new Set(['10.0.0.1']),
      () => 'answer',
      () => spawned.length > 1,
    );
    const icmp = new PsHelperIcmp(spawner, clock, new MemoryLogger(), { startupTimeoutMs: 20_000 });
    const first = icmp.ping('10.0.0.1', 1000);
    await clock.advanceAsync(20_005);
    expect(await first).toEqual({ alive: false, latencyMs: null });
    expect(spawned[0]?.killed).toBe(true);
    expect(spawned[0]?.requests).toEqual([]);
    const second = icmp.ping('10.0.0.1', 1000);
    await clock.advanceAsync(10);
    expect((await second).alive).toBe(true);
    expect(spawned).toHaveLength(2);
  });
});
