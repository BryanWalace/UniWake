/**
 * UDP magic-packet sender (FR-003.2, plan §2.6, §7.1). One socket per source interface, bound to
 * that interface's IPv4 so broadcasts leave through it (a socket bound to 0.0.0.0 would use only
 * the lowest-metric NIC on Windows — phase-0 debug review). Failed sockets are evicted, so an
 * interface that disappears and comes back is retried with a fresh socket.
 */
import dgram from 'node:dgram';
import { once } from 'node:events';
import type { PacketSender, PacketSendRequest } from '../application/ports';

export type SocketFactory = () => dgram.Socket;

const defaultFactory: SocketFactory = () => dgram.createSocket({ type: 'udp4', reuseAddr: true });

export class UdpPacketSender implements PacketSender {
  private readonly sockets = new Map<string, Promise<dgram.Socket>>();

  constructor(private readonly factory: SocketFactory = defaultFactory) {}

  private socketFor(sourceIp: string): Promise<dgram.Socket> {
    let pending = this.sockets.get(sourceIp);
    if (!pending) {
      pending = (async () => {
        const socket = this.factory();
        socket.on('error', () => this.evict(sourceIp, socket));
        const listening = once(socket, 'listening');
        socket.bind({ address: sourceIp, port: 0, exclusive: false });
        await listening; // rejects with the bind error (e.g. EADDRNOTAVAIL)
        socket.setBroadcast(true);
        return socket;
      })();
      this.sockets.set(sourceIp, pending);
      pending.catch(() => this.sockets.delete(sourceIp));
    }
    return pending;
  }

  private evict(sourceIp: string, socket: dgram.Socket) {
    this.sockets.delete(sourceIp);
    try {
      socket.close();
    } catch {
      // already closed
    }
  }

  async send(req: PacketSendRequest): Promise<void> {
    const socket = await this.socketFor(req.sourceIp);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.send(req.payload, req.port, req.destination, (err) =>
          err ? reject(err) : resolve(),
        );
      });
    } catch (e) {
      this.evict(req.sourceIp, socket);
      throw e;
    }
  }

  async close(): Promise<void> {
    const all = [...this.sockets.entries()];
    this.sockets.clear();
    for (const [, pending] of all) {
      try {
        (await pending).close();
      } catch {
        // failed sockets were never opened
      }
    }
  }
}
