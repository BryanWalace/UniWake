/**
 * Team-mode sockets (ADR-035, ADR-038, plan §14). One TCP port carries pairing (plain JSON lines,
 * first byte `{`) and sync (TLS 1.3 PSK, first byte 0x16 = TLS handshake record); one UDP socket on
 * the same port number carries announcements. Every message is one JSON line with a size limit.
 */
import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';
import type {
  MessageChannel,
  SyncEndpoint,
  SyncListenHandlers,
  SyncNetwork,
} from '../application/ports';

const TLS_HANDSHAKE = 0x16;
const JSON_START = 0x7b; // '{'
const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface SyncNetworkOptions {
  /** Largest accepted line on sync sessions, bytes (plan §14.5: 64 MB). */
  maxSyncLine?: number;
  /** Largest accepted line on pairing connections (8 MB; real messages are < 4 KB). */
  maxPairingLine?: number;
  /** TCP bind address; 0.0.0.0 in production, 127.0.0.1 in tests. */
  bind?: string;
}

class JsonLinesChannel implements MessageChannel {
  private buffer = '';
  private readonly queue: unknown[] = [];
  private waiting: { resolve: (v: unknown) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(
    private readonly socket: net.Socket,
    private readonly maxLine: number,
    readonly remoteAddress: string,
  ) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('connection closed')));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (Buffer.byteLength(line) > this.maxLine) {
        this.fail(new Error('message too large'));
        this.socket.destroy();
        return;
      }
      if (line.trim() === '') continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        this.fail(new Error('malformed message'));
        this.socket.destroy();
        return;
      }
      this.push(msg);
    }
    if (Buffer.byteLength(this.buffer) > this.maxLine) {
      this.fail(new Error('message too large'));
      this.socket.destroy();
    }
  }

  private push(msg: unknown) {
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w.resolve(msg);
    } else this.queue.push(msg);
  }

  private fail(e: Error) {
    this.failure ??= e;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w.reject(this.failure);
    }
  }

  send(msg: unknown): void {
    if (!this.socket.destroyed) this.socket.write(`${JSON.stringify(msg)}\n`);
  }

  receive(timeoutMs: number): Promise<unknown> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error('timeout'));
      }, timeoutMs);
      timer.unref?.();
      this.waiting = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
    });
  }

  close(): void {
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref?.();
  }
}

// OpenSSL only offers PSK when a PSK cipher is in the (TLS 1.2) list, even for TLS 1.3 sessions.
const pskOptions = {
  minVersion: 'TLSv1.3',
  maxVersion: 'TLSv1.3',
  ciphers: 'ECDHE-PSK-CHACHA20-POLY1305',
} as const;

export class NodeSyncNetwork implements SyncNetwork {
  private servers: net.Server[] = [];
  private udp: dgram.Socket | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly maxSync: number;
  private readonly maxPairing: number;
  private readonly bind: string;

  constructor(opts: SyncNetworkOptions = {}) {
    this.maxSync = opts.maxSyncLine ?? 64 * 1024 * 1024;
    this.maxPairing = opts.maxPairingLine ?? 8 * 1024 * 1024;
    this.bind = opts.bind ?? '0.0.0.0';
  }

  private track(s: net.Socket) {
    this.sockets.add(s);
    s.on('close', () => this.sockets.delete(s));
  }

  listen(port: number, h: SyncListenHandlers): Promise<number> {
    const server = net.createServer((raw) => {
      this.track(raw);
      const remote = raw.remoteAddress?.replace(/^::ffff:/, '') ?? '';
      raw.setTimeout(HANDSHAKE_TIMEOUT_MS, () => raw.destroy());
      // Peek at the first byte without consuming it: TLSSocket picks up whatever is still buffered.
      raw.once('readable', () => {
        const first = raw.read(1) as Buffer | null;
        if (!first) return void raw.destroy();
        raw.unshift(first);
        if (first[0] === JSON_START) {
          raw.setTimeout(0);
          h.onPairing(new JsonLinesChannel(raw, this.maxPairing, remote));
          raw.resume();
        } else if (first[0] === TLS_HANDSHAKE) {
          let identity = '';
          // TLSSocket accepts the server PSK callback at run time; @types/node only declares it on
          // tls.createServer, hence the wider options type.
          const options: tls.TLSSocketOptions & {
            pskCallback: (socket: tls.TLSSocket, id: string) => Buffer | null;
          } = {
            isServer: true,
            ...pskOptions,
            pskCallback: (_s, id) => {
              identity = id;
              return h.pskFor(id);
            },
          };
          const secure = new tls.TLSSocket(raw, options);
          this.track(secure);
          secure.on('error', () => secure.destroy());
          secure.once('secure', () => {
            raw.setTimeout(0);
            h.onSync(new JsonLinesChannel(secure, this.maxSync, remote), identity);
          });
        } else {
          raw.destroy();
        }
      });
      raw.on('error', () => raw.destroy());
    });
    this.servers.push(server);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, this.bind, () => {
        server.off('error', reject);
        resolve((server.address() as net.AddressInfo).port);
      });
    });
  }

  connectPairing(to: SyncEndpoint, timeoutMs: number): Promise<MessageChannel> {
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: to.host, port: to.port });
      this.track(s);
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error('timeout'));
      }, timeoutMs);
      s.once('connect', () => {
        clearTimeout(timer);
        resolve(new JsonLinesChannel(s, this.maxPairing, to.host));
      });
      s.once('error', (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  connectSync(
    to: SyncEndpoint,
    identity: string,
    psk: Buffer,
    timeoutMs: number,
  ): Promise<MessageChannel> {
    return new Promise((resolve, reject) => {
      const s = tls.connect({
        host: to.host,
        port: to.port,
        ...pskOptions,
        // PSK authenticates the server; there is no certificate to check.
        checkServerIdentity: () => undefined,
        pskCallback: () => ({ psk, identity }),
      });
      this.track(s);
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error('timeout'));
      }, timeoutMs);
      s.once('secureConnect', () => {
        clearTimeout(timer);
        resolve(new JsonLinesChannel(s, this.maxSync, to.host));
      });
      s.once('error', (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  listenAnnouncements(
    port: number,
    onMessage: (msg: unknown, from: string) => void,
  ): Promise<number> {
    const sock = this.ensureUdp();
    sock.on('message', (buf, rinfo) => {
      if (buf.length > 4096) return;
      try {
        onMessage(JSON.parse(buf.toString('utf8')), rinfo.address);
      } catch {
        // Not ours: ignore.
      }
    });
    return new Promise((resolve, reject) => {
      sock.once('error', reject);
      // The same bind address as TCP: 0.0.0.0 receives LAN broadcasts; tests stay on loopback.
      sock.bind({ port, address: this.bind, exclusive: false }, () => {
        sock.off('error', reject);
        sock.setBroadcast(true);
        resolve(sock.address().port);
      });
    });
  }

  private ensureUdp(): dgram.Socket {
    this.udp ??= dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('error', () => undefined);
    return this.udp;
  }

  async announce(msg: unknown, targets: readonly SyncEndpoint[]): Promise<void> {
    const data = Buffer.from(JSON.stringify(msg));
    let sock = this.udp;
    let temp = false;
    if (!sock) {
      temp = true;
      sock = dgram.createSocket('udp4');
      await new Promise<void>((r) => sock!.bind({ port: 0, address: this.bind }, () => r()));
      sock.setBroadcast(true);
    }
    await Promise.all(
      targets.map((t) => new Promise<void>((r) => sock.send(data, t.port, t.host, () => r()))),
    );
    if (temp) sock.close();
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await Promise.all(this.servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    this.servers = [];
    if (this.udp) {
      const u = this.udp;
      this.udp = null;
      await new Promise<void>((r) => {
        try {
          u.close(() => r());
        } catch {
          r();
        }
      });
    }
  }
}
