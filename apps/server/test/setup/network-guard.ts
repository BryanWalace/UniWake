/**
 * Network guard for tests (constitution §5): any UDP send, TCP connect or DNS query for a
 * non-loopback destination throws. Loopback and local IPC (named pipes) stay allowed.
 */
/* eslint-disable @typescript-eslint/unbound-method -- the guard deliberately captures prototype methods and re-applies them with the original `this`. */
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

export class NetworkGuardError extends Error {
  constructor(destination: string) {
    super(`Network guard: tests must not reach non-loopback destination "${destination}"`);
    this.name = 'NetworkGuardError';
  }
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host === '') return true; // Node defaults to localhost
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  const v4 = h.startsWith('::ffff:') ? h.slice(7) : h;
  return /^127(\.\d{1,3}){3}$/.test(v4);
}

let installed = false;

export function installNetworkGuard(): void {
  if (installed) return;
  installed = true;

  const origSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function guardedSend(this: dgram.Socket, ...args: unknown[]) {
    // send(msg, [offset, length,] port, [address], [callback]) — address is the first string after msg.
    const address = args.slice(1).find((a): a is string => typeof a === 'string');
    if (address !== undefined && !isLoopbackHost(address)) throw new NetworkGuardError(address);
    return (origSend as (...a: unknown[]) => void).apply(this, args);
  } as typeof dgram.Socket.prototype.send;

  const origUdpConnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function guardedUdpConnect(
    this: dgram.Socket,
    ...args: unknown[]
  ) {
    const address = args.find((a): a is string => typeof a === 'string');
    if (address !== undefined && !isLoopbackHost(address)) throw new NetworkGuardError(address);
    return (origUdpConnect as (...a: unknown[]) => void).apply(this, args);
  };

  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    let host: string | undefined;
    if (typeof first === 'object' && first !== null) {
      const opts = first as { host?: unknown; hostname?: unknown; path?: unknown };
      // Only a string path means local IPC; http passes `path: null` for TCP connections.
      if (typeof opts.path === 'string')
        return (origConnect as (...a: unknown[]) => net.Socket).apply(this, args);
      host =
        typeof opts.host === 'string'
          ? opts.host
          : typeof opts.hostname === 'string'
            ? opts.hostname
            : undefined;
    } else if (typeof first === 'string' && Number.isNaN(Number(first))) {
      // connect(path) — IPC
      return (origConnect as (...a: unknown[]) => net.Socket).apply(this, args);
    } else {
      host = typeof args[1] === 'string' ? args[1] : undefined;
    }
    if (!isLoopbackHost(host)) throw new NetworkGuardError(host ?? '?');
    return (origConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  };
}

/** DNS methods that send queries; `reverse` takes an IP, the others a host name. */
const DNS_METHODS = [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
] as const;

/**
 * Regression for M1-F1: the first guard only patched dgram/net, and a test resolved a real
 * name. DNS goes through the OS resolver, so it must be blocked separately.
 */
function guardDns(): void {
  const wrap = (target: object, isPromise: boolean) => {
    const t = target as Record<string, unknown>;
    for (const name of DNS_METHODS) {
      const orig = t[name];
      if (typeof orig !== 'function') continue;
      t[name] = function guardedDns(this: unknown, ...args: unknown[]) {
        const host = typeof args[0] === 'string' ? args[0] : undefined;
        // IP literals resolve locally (dgram looks up "0.0.0.0" to auto-bind); only names query DNS.
        const isIpLiteral = host !== undefined && net.isIP(host) !== 0 && name !== 'reverse';
        if (!isIpLiteral && !isLoopbackHost(host)) {
          const err = new NetworkGuardError(host ?? '?');
          if (isPromise) return Promise.reject(err);
          throw err;
        }
        return (orig as (...a: unknown[]) => unknown).apply(this, args);
      };
    }
  };
  wrap(dns, false);
  wrap(dns.promises, true);
  wrap(dns.Resolver.prototype, false);
  wrap(dns.promises.Resolver.prototype, true);
}

/** Programs a test may never start: they act on the real machine or network (constitution §5). */
const FORBIDDEN_PROGRAMS = new Set(['shutdown.exe', 'shutdown']);
/** Programs that reach the host named in their arguments. */
const NETWORK_PROGRAMS = new Set(['ping.exe', 'ping', 'tracert.exe', 'pathping.exe']);

export class ProcessGuardError extends Error {
  constructor(what: string) {
    super(`Process guard: tests must not run ${what}`);
    this.name = 'ProcessGuardError';
  }
}

/** Throws for a process a test must not start; returns otherwise. */
export function checkSpawn(file: string, args: readonly unknown[]): void {
  const exe = (file.split(/[\\/]/).pop() ?? file).toLowerCase();
  if (FORBIDDEN_PROGRAMS.has(exe)) throw new ProcessGuardError(exe);
  if (!NETWORK_PROGRAMS.has(exe)) return;
  for (const a of args) {
    if (typeof a !== 'string' || a.startsWith('-') || a.startsWith('/')) continue;
    if (net.isIP(a) !== 0 || /[a-z]/i.test(a)) {
      if (!isLoopbackHost(a)) throw new NetworkGuardError(`${exe} ${a}`);
    }
  }
}

/**
 * M16-D: on Windows the hub's monitor runs `ping.exe` for devices with an IP, which put real ICMP
 * on the LAN from hub tests (and shutdown.exe must never run from a test, v1.3). ESM named imports
 * of builtins are live bindings, so after patching the module object the exports are re-synced.
 */
function guardProcesses(): void {
  const cp = childProcess as unknown as Record<string, unknown>;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync'] as const) {
    const orig = cp[name] as (...a: unknown[]) => unknown;
    cp[name] = function guardedProcess(this: unknown, file: unknown, ...rest: unknown[]) {
      const args = Array.isArray(rest[0]) ? (rest[0] as unknown[]) : [];
      if (typeof file === 'string') checkSpawn(file, args);
      return orig.call(this, file, ...rest);
    };
  }
  syncBuiltinESMExports();
}

installNetworkGuard();
guardDns();
guardProcesses();
