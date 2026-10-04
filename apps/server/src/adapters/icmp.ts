/**
 * ICMP probing without admin rights (ADR-019).
 * - PsHelperIcmp: a persistent PowerShell helper (helper/probe-helper.ps1). Individual pings are
 *   micro-batched into one JSON request; each request has a deadline; a hung or dead helper is
 *   restarted; after 3 restarts in 5 min the helper is reported unhealthy so the composite prober
 *   switches to ping.exe for 30 min (phase-2 D2-03).
 * - PingExeIcmp: fallback using ping.exe; success = exit code 0 and "TTL=" in the output
 *   (the rest of the text is localized).
 * - CompositeProber: ICMP first, TCP ports when there is no echo reply (ADR-014).
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { win32 } from 'node:path';
import type {
  Clock,
  Logger,
  Prober,
  ProbeOptions,
  ProbeResult,
  ProcessRunner,
  TimerHandle,
} from '../application/ports';
import { mapLimit, type TcpProber } from './tcp-prober';

export interface PingResult {
  alive: boolean;
  latencyMs: number | null;
}

export interface IcmpPinger {
  ping(address: string, timeoutMs: number): Promise<PingResult>;
}

// ---------------------------------------------------------------- persistent helper

export interface ChildHandle {
  write(line: string): void;
  onLine(cb: (line: string) => void): void;
  onExit(cb: () => void): void;
  kill(): void;
}
export type HelperSpawner = () => ChildHandle;

export function powershellSpawner(
  scriptPath: string,
  systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
): HelperSpawner {
  const exe = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return () => {
    const child = spawn(
      exe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    const rl = createInterface({ input: child.stdout });
    // Writing after the helper died raises EPIPE/EOF on stdin; the exit handler deals with it.
    child.stdin.on('error', () => undefined);
    return {
      write: (line) => {
        child.stdin.write(`${line}\n`);
      },
      onLine: (cb) => rl.on('line', cb),
      onExit: (cb) => {
        child.on('exit', cb);
        child.on('error', cb);
      },
      kill: () => {
        child.kill();
      },
    };
  };
}

interface Waiting {
  address: string;
  resolve: (r: PingResult) => void;
}

interface InFlight {
  entries: Waiting[];
  deadline: TimerHandle;
}

export interface HelperOptions {
  batchWindowMs?: number;
  maxBatch?: number;
  restartLimit?: number;
  restartWindowMs?: number;
  cooldownMs?: number;
  /** How long a fresh helper may take to print its ready line (PowerShell cold start). */
  startupTimeoutMs?: number;
}

const DEAD: PingResult = { alive: false, latencyMs: null };

export class PsHelperIcmp implements IcmpPinger {
  private child: ChildHandle | null = null;
  private ready = false;
  private startupTimer: TimerHandle | null = null;
  private nextId = 1;
  private readonly inFlight = new Map<number, InFlight>();
  private readonly queues = new Map<number, Waiting[]>(); // by timeout
  private flushTimer: TimerHandle | null = null;
  private restarts: number[] = [];
  private unhealthyUntil = 0;
  private readonly o: Required<HelperOptions>;

  constructor(
    private readonly spawner: HelperSpawner,
    private readonly clock: Clock,
    private readonly logger: Logger,
    opts: HelperOptions = {},
  ) {
    this.o = {
      batchWindowMs: opts.batchWindowMs ?? 5,
      maxBatch: opts.maxBatch ?? 256,
      restartLimit: opts.restartLimit ?? 3,
      restartWindowMs: opts.restartWindowMs ?? 5 * 60_000,
      cooldownMs: opts.cooldownMs ?? 30 * 60_000,
      startupTimeoutMs: opts.startupTimeoutMs ?? 30_000,
    };
  }

  /** False after repeated failures; the composite prober then uses the fallback for a while. */
  get healthy(): boolean {
    return this.clock.now() >= this.unhealthyUntil;
  }

  ping(address: string, timeoutMs: number): Promise<PingResult> {
    return new Promise((resolve) => {
      const q = this.queues.get(timeoutMs) ?? [];
      q.push({ address, resolve });
      this.queues.set(timeoutMs, q);
      if (q.length >= this.o.maxBatch) this.flush();
      else this.flushTimer ??= this.clock.setTimeout(() => this.flush(), this.o.batchWindowMs);
    });
  }

  close(): void {
    for (const b of this.batches.splice(0)) for (const w of b.entries) w.resolve(DEAD);
    this.clearStartup();
    this.child?.kill();
    this.child = null;
    for (const f of this.inFlight.values()) this.fail(f);
    this.inFlight.clear();
  }

  private ensureChild(): ChildHandle {
    if (this.child) return this.child;
    const child = this.spawner();
    this.ready = false;
    this.child = child;
    this.startupTimer = this.clock.setTimeout(
      () => this.onStartupTimeout(child),
      this.o.startupTimeoutMs,
    );
    child.onLine((line) => this.onLine(line));
    child.onExit(() => {
      if (this.child !== child) return;
      this.clearStartup();
      this.child = null;
      this.logger.warn({}, 'probe helper exited');
      this.noteRestart();
      for (const f of this.inFlight.values()) this.fail(f);
      this.inFlight.clear();
      this.pump();
    });
    return child;
  }

  private clearStartup() {
    if (this.startupTimer !== null) this.clock.clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  /** The helper never said it was ready: give up on it and fail the batch that was waiting. */
  private onStartupTimeout(child: ChildHandle) {
    this.startupTimer = null;
    if (this.child !== child || this.ready) return;
    this.logger.warn({}, 'probe helper did not become ready; restarting it');
    this.child = null;
    child.kill();
    this.noteRestart();
    const head = this.batches.shift();
    for (const w of head?.entries ?? []) w.resolve(DEAD);
    this.pump();
  }

  private readonly batches: { entries: Waiting[]; timeout: number }[] = [];

  private flush() {
    if (this.flushTimer !== null) {
      this.clock.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    for (const [timeout, q] of this.queues) {
      this.queues.delete(timeout);
      for (let i = 0; i < q.length; i += this.o.maxBatch) {
        this.batches.push({ entries: q.slice(i, i + this.o.maxBatch), timeout });
      }
    }
    this.pump();
  }

  /**
   * The helper answers requests one at a time, so only one is in flight: a deadline measured from
   * the moment of sending would otherwise expire for requests merely waiting in its queue.
   */
  private pump() {
    if (this.inFlight.size > 0 || this.batches.length === 0) return;
    let child: ChildHandle;
    try {
      child = this.ensureChild();
    } catch (e) {
      this.logger.warn({ err: e }, 'probe helper could not start');
      this.noteRestart();
      for (const w of this.batches.shift()!.entries) w.resolve(DEAD);
      queueMicrotask(() => this.pump());
      return;
    }
    if (!this.ready) return; // the ready line pumps again
    const next = this.batches.shift()!;
    this.send(child, next.entries, next.timeout);
  }

  private send(child: ChildHandle, entries: Waiting[], timeout: number) {
    const id = this.nextId++;
    const deadline = this.clock.setTimeout(() => this.onDeadline(id), timeout + 3000);
    this.inFlight.set(id, { entries, deadline });
    child.write(JSON.stringify({ id, targets: entries.map((e) => e.address), timeout }));
  }

  private onLine(line: string) {
    let msg: { id?: number; results?: unknown; ready?: boolean };
    try {
      msg = JSON.parse(line) as { id?: number; results?: unknown; ready?: boolean };
    } catch {
      return; // ignore anything that is not our JSON (warnings, banners)
    }
    if (msg.ready === true) {
      this.ready = true;
      this.clearStartup();
      this.pump();
      return;
    }
    if (typeof msg.id !== 'number') return;
    const f = this.inFlight.get(msg.id);
    if (!f) return;
    this.inFlight.delete(msg.id);
    this.clock.clearTimeout(f.deadline);
    const raw = msg.results;
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as {
      t?: string;
      s?: string;
      ms?: number;
    }[];
    queueMicrotask(() => this.pump());
    f.entries.forEach((w, i) => {
      const r = list[i];
      w.resolve(
        r && r.s === 'Success'
          ? { alive: true, latencyMs: typeof r.ms === 'number' ? r.ms : null }
          : DEAD,
      );
    });
  }

  private onDeadline(id: number) {
    const f = this.inFlight.get(id);
    if (!f) return;
    this.inFlight.delete(id);
    this.logger.warn({ requestId: id }, 'probe helper missed its deadline; restarting it');
    this.fail(f);
    const child = this.child;
    this.child = null;
    this.clearStartup();
    child?.kill();
    this.noteRestart();
    this.pump();
  }

  private fail(f: InFlight) {
    this.clock.clearTimeout(f.deadline);
    for (const w of f.entries) w.resolve(DEAD);
  }

  private noteRestart() {
    const now = this.clock.now();
    this.restarts = [...this.restarts.filter((t) => now - t < this.o.restartWindowMs), now];
    if (this.restarts.length >= this.o.restartLimit) {
      this.unhealthyUntil = now + this.o.cooldownMs;
      this.restarts = [];
      this.logger.error({}, 'probe helper unhealthy; using ping.exe fallback for a while');
    }
  }
}

// ---------------------------------------------------------------- ping.exe fallback

export class PingExeIcmp implements IcmpPinger {
  private readonly exe: string;

  constructor(
    private readonly runner: ProcessRunner,
    systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  ) {
    this.exe = win32.join(systemRoot, 'System32', 'ping.exe');
  }

  async ping(address: string, timeoutMs: number): Promise<PingResult> {
    try {
      const r = await this.runner.run(this.exe, ['-n', '1', '-w', String(timeoutMs), address], {
        timeoutMs: timeoutMs + 3000,
      });
      return parsePingOutput(r.exitCode, r.stdout);
    } catch {
      return DEAD;
    }
  }
}

/**
 * Success needs exit code 0 and "TTL=" (a real echo reply). Windows returns 0 for
 * "Destination host unreachable" replies sent by a router, which have no TTL. Latency is read
 * from `=12ms` / `<1ms` (any language).
 */
export function parsePingOutput(exitCode: number, stdout: string): PingResult {
  if (exitCode !== 0 || !/TTL=/i.test(stdout)) return DEAD;
  const m = /[=<]\s?(\d+)\s?ms/i.exec(stdout);
  return { alive: true, latencyMs: m ? Number(m[1]) : null };
}

// ---------------------------------------------------------------- composite

export class CompositeProber implements Prober {
  constructor(
    private readonly tcp: TcpProber,
    private readonly helper: PsHelperIcmp | null,
    private readonly fallback: IcmpPinger | null,
    private readonly concurrency: () => number = () => 64,
  ) {}

  /** Which ICMP path is in use (health page, FR-012). */
  get icmpMode(): 'helper' | 'fallback' | 'none' {
    if (this.helper?.healthy) return 'helper';
    return this.fallback ? 'fallback' : 'none';
  }

  private icmp(): IcmpPinger | null {
    if (this.helper?.healthy) return this.helper;
    return this.fallback;
  }

  async probe(addresses: readonly string[], opts: ProbeOptions): Promise<Map<string, ProbeResult>> {
    const results = await mapLimit(
      addresses,
      this.concurrency(),
      async (address): Promise<ProbeResult> => {
        const icmp = this.icmp();
        if (icmp && opts.icmpTimeoutMs > 0) {
          const r = await icmp.ping(address, opts.icmpTimeoutMs);
          if (r.alive) return { alive: true, via: 'icmp', latencyMs: r.latencyMs };
        }
        return (
          (await this.tcp.probe([address], opts)).get(address) ?? {
            alive: false,
            via: null,
            latencyMs: null,
          }
        );
      },
    );
    return new Map(addresses.map((a, i) => [a, results[i]!]));
  }
}
