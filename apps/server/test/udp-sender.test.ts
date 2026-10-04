import dgram from 'node:dgram';
import { EventEmitter, once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { RecordingPacketSender } from '../src/adapters/recording-packet-sender';
import { UdpPacketSender } from '../src/adapters/udp-packet-sender';
import { magicPacket } from '../src/domain/magic-packet';
import { errnoError } from './fakes/faults';

describe('UDP sender loopback contract (M3-T06)', () => {
  it('a real magic packet sent from 127.0.0.1 arrives byte-for-byte at a loopback listener', async () => {
    const rx = dgram.createSocket('udp4');
    rx.bind(0, '127.0.0.1');
    await once(rx, 'listening');
    const port = rx.address().port;
    const sender = new UdpPacketSender();
    const payload = magicPacket('00:1A:2B:3C:4D:5E');
    const received = once(rx, 'message');
    await sender.send({ sourceIp: '127.0.0.1', destination: '127.0.0.1', port, payload });
    const [msg, from] = (await received) as [Buffer, dgram.RemoteInfo];
    expect(new Uint8Array(msg)).toEqual(payload);
    expect(from.address).toBe('127.0.0.1');
    await sender.close();
    rx.close();
  });
});

/** Minimal dgram.Socket stand-in with scripted bind/send outcomes. */
class FakeSocket extends EventEmitter {
  bound: string | null = null;
  broadcast = false;
  closed = false;
  sent: { port: number; destination: string; bytes: number }[] = [];
  constructor(
    private readonly bindError: Error | null,
    private readonly sendError: () => Error | null,
  ) {
    super();
  }
  bind(opts: { address: string }) {
    setImmediate(() => {
      if (this.bindError) this.emit('error', this.bindError);
      else {
        this.bound = opts.address;
        this.emit('listening');
      }
    });
    return this;
  }
  setBroadcast(v: boolean) {
    this.broadcast = v;
  }
  send(payload: Uint8Array, port: number, destination: string, cb: (e: Error | null) => void) {
    const err = this.sendError();
    if (!err) this.sent.push({ port, destination, bytes: payload.length });
    setImmediate(() => cb(err));
  }
  close() {
    this.closed = true;
  }
}

describe('UDP sender behavior with injected sockets', () => {
  const req = (sourceIp: string) => ({
    sourceIp,
    destination: '255.255.255.255',
    port: 9,
    payload: magicPacket('00:11:22:33:44:55'),
  });

  it('binds one broadcast socket per source interface and reuses it', async () => {
    const created: FakeSocket[] = [];
    const sender = new UdpPacketSender(() => {
      const s = new FakeSocket(null, () => null);
      created.push(s);
      return s as unknown as dgram.Socket;
    });
    await sender.send(req('10.0.3.15'));
    await sender.send(req('10.0.3.15'));
    await sender.send(req('10.0.4.20'));
    expect(created).toHaveLength(2);
    expect(created.map((s) => [s.bound, s.broadcast, s.sent.length])).toEqual([
      ['10.0.3.15', true, 2],
      ['10.0.4.20', true, 1],
    ]);
    await sender.close();
    expect(created.every((s) => s.closed)).toBe(true);
  });

  it('a vanished interface (EADDRNOTAVAIL on bind) rejects, and the next send tries a fresh socket', async () => {
    let attempt = 0;
    const sender = new UdpPacketSender(() => {
      attempt++;
      return new FakeSocket(
        attempt === 1 ? errnoError('EADDRNOTAVAIL') : null,
        () => null,
      ) as unknown as dgram.Socket;
    });
    await expect(sender.send(req('10.0.9.9'))).rejects.toMatchObject({ code: 'EADDRNOTAVAIL' });
    await sender.send(req('10.0.9.9'));
    expect(attempt).toBe(2);
  });

  it('a send error rejects and evicts the socket', async () => {
    const created: FakeSocket[] = [];
    let fail = true;
    const sender = new UdpPacketSender(() => {
      const s = new FakeSocket(null, () => (fail ? errnoError('ENETUNREACH') : null));
      created.push(s);
      return s as unknown as dgram.Socket;
    });
    await expect(sender.send(req('10.0.3.15'))).rejects.toMatchObject({ code: 'ENETUNREACH' });
    fail = false;
    await sender.send(req('10.0.3.15'));
    expect(created).toHaveLength(2);
    expect(created[0]?.closed).toBe(true);
  });
});

describe('recording sender (dry-run, FR-003.7)', () => {
  it('records without touching the network and keeps only recent entries', async () => {
    const r = new RecordingPacketSender(2);
    for (const port of [9, 7, 9]) {
      await r.send({
        sourceIp: '10.0.0.1',
        destination: '255.255.255.255',
        port,
        payload: new Uint8Array(102),
      });
    }
    expect(r.count).toBe(3);
    expect(r.recent).toEqual([
      { sourceIp: '10.0.0.1', destination: '255.255.255.255', port: 7, bytes: 102 },
      { sourceIp: '10.0.0.1', destination: '255.255.255.255', port: 9, bytes: 102 },
    ]);
    await r.close();
  });
});
