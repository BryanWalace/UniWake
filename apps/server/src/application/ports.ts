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
  /** Names for an IPv4 address (reverse lookup); optional, used by discovery (FR-101). */
  reverse?(ip: string): Promise<string[]>;
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
  /** Hex SHA-256 of the file's bytes (streamed). */
  sha256(path: string): Promise<string>;
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

// ---------------------------------------------------------------- Team mode (v1.2, plan §14)
/** ADR-037: encrypts team secrets at rest (DPAPI LocalMachine on Windows). */
export interface SecretProtector {
  protect(plain: Buffer): Promise<Buffer>;
  unprotect(blob: Buffer): Promise<Buffer>;
}

/** A JSON-lines channel (pairing over TCP, sync over TLS-PSK). Messages are validated by callers. */
export interface MessageChannel {
  readonly remoteAddress: string;
  send(msg: unknown): void;
  /** The next message; rejects on timeout, close, malformed JSON or an oversized line. */
  receive(timeoutMs: number): Promise<unknown>;
  close(): void;
}

export interface SyncListenHandlers {
  /** A plain TCP connection whose first byte is `{`. */
  onPairing(ch: MessageChannel): void;
  /** The PSK for a TLS identity, or null to refuse the handshake. */
  pskFor(identity: string): Buffer | null;
  /** An established TLS-PSK session. */
  onSync(ch: MessageChannel, identity: string): void;
}

export interface SyncEndpoint {
  host: string;
  port: number;
}

/** Sockets for team mode (ADR-035, ADR-038). The application never touches node:net/tls/dgram. */
export interface SyncNetwork {
  /** TCP listener (pairing + sync on one port); port 0 = ephemeral. Returns the bound port. */
  listen(port: number, handlers: SyncListenHandlers): Promise<number>;
  connectPairing(to: SyncEndpoint, timeoutMs: number): Promise<MessageChannel>;
  connectSync(
    to: SyncEndpoint,
    identity: string,
    psk: Buffer,
    timeoutMs: number,
  ): Promise<MessageChannel>;
  /** UDP discovery socket; port 0 = ephemeral. Returns the bound port. */
  listenAnnouncements(
    port: number,
    onMessage: (msg: unknown, from: string) => void,
  ): Promise<number>;
  announce(msg: unknown, targets: readonly SyncEndpoint[]): Promise<void>;
  close(): Promise<void>;
}
