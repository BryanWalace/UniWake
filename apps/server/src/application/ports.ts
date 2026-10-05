/**
 * Ports (constitution §2.2). Application code depends on these interfaces only; adapters implement
 * them and tests use the fakes in `apps/server/test/fakes`. Every port that does I/O can fail, so
 * callers must handle rejections.
 */

// ---------------------------------------------------------------- Clock
export type TimerHandle = { readonly __timer: unique symbol } | number | object;

export interface Clock {
  /** Epoch milliseconds (UTC). */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  sleep(ms: number): Promise<void>;
}

// ---------------------------------------------------------------- Logger
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

// ---------------------------------------------------------------- Network interfaces
export type { NetInterface } from '../domain/network';

import type { NetInterface } from '../domain/network';

export interface NetworkInterfaces {
  /** Reads the current IPv4 interfaces (never cached; constitution §2.6). */
  list(): Promise<NetInterface[]>;
}

// ---------------------------------------------------------------- Packet sender
export interface PacketSendRequest {
  /** Local IPv4 to bind to, so the packet leaves through that interface. */
  sourceIp: string;
  destination: string;
  port: number;
  payload: Uint8Array;
}

export interface PacketSender {
  /** Sends one UDP datagram; rejects on bind/send failure. */
  send(req: PacketSendRequest): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------- Prober
export interface ProbeOptions {
  icmpTimeoutMs: number;
  tcpPorts: readonly number[];
  tcpTimeoutMs: number;
}

export type ProbeVia = 'icmp' | 'tcp' | 'tcp-refused';

export interface ProbeResult {
  alive: boolean;
  via: ProbeVia | null;
  latencyMs: number | null;
}

export interface Prober {
  /** Probes each address (ICMP, then TCP ports). Must resolve for every address given. */
  probe(addresses: readonly string[], opts: ProbeOptions): Promise<Map<string, ProbeResult>>;
}

// ---------------------------------------------------------------- DNS
export interface DnsResolver {
  /** IPv4 addresses for `hostname`; rejects on failure or timeout. */
  resolve4(hostname: string): Promise<string[]>;
}

// ---------------------------------------------------------------- File system
export interface FileSystem {
  readText(path: string): Promise<string>;
  /** Writes atomically (temp file + rename). */
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  size(path: string): Promise<number>;
  mkdirp(dir: string): Promise<void>;
  freeBytes(path: string): Promise<number>;
}

// ---------------------------------------------------------------- Processes
export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs?: number;
  stdin?: string;
  cwd?: string;
}

export interface ProcessRunner {
  /** Runs `file` with an argument array (never a shell string; plan §9.1). */
  run(file: string, args: readonly string[], opts?: RunOptions): Promise<ProcessResult>;
}

// ---------------------------------------------------------------- Releases (update source)
export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseInfo {
  tag: string;
  version: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string;
  assets: ReleaseAsset[];
}

export interface ReleaseSource {
  latest(): Promise<{ release: ReleaseInfo | null; serverDate: number | null }>;
  /** Downloads `url` to `dest`; rejects on failure. */
  download(url: string, dest: string): Promise<void>;
}

// ---------------------------------------------------------------- Log viewer (FR-016)
export interface LogLine {
  time: string;
  level: string;
  msg: string;
  module: string | null;
  /** Everything else on the line (request ids, errors, counts). */
  data: Record<string, unknown>;
}

export interface LogSource {
  /** Newest first, from the tail of the current file. */
  read(q: { level?: 'debug' | 'info' | 'warn' | 'error'; q?: string; limit?: number }): {
    entries: LogLine[];
    truncated: boolean;
    size: number;
  };
  /** The current log file for download, or null when there is none yet. */
  open(): NodeJS.ReadableStream | null;
}
