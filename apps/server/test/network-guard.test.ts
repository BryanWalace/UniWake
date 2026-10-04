import dgram from 'node:dgram';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { isLoopbackHost, NetworkGuardError } from './setup/network-guard';

describe('network guard (constitution §5)', () => {
  it('classifies loopback hosts', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1']) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
    for (const h of [
      '192.0.2.1',
      '10.0.0.1',
      '255.255.255.255',
      'example.com',
      '::ffff:10.0.0.1',
    ]) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it('blocks UDP sends to non-loopback addresses (incl. broadcast)', () => {
    const s = dgram.createSocket('udp4');
    try {
      expect(() => s.send(Buffer.from('x'), 9, '192.0.2.1')).toThrow(NetworkGuardError);
      expect(() => s.send(Buffer.from('x'), 0, 1, 9, '255.255.255.255')).toThrow(NetworkGuardError);
    } finally {
      s.close();
    }
  });

  it('allows UDP on loopback', async () => {
    const rx = dgram.createSocket('udp4');
    rx.bind(0, '127.0.0.1');
    await once(rx, 'listening');
    const port = rx.address().port;
    const tx = dgram.createSocket('udp4');
    const received = once(rx, 'message');
    tx.send(Buffer.from('hello'), port, '127.0.0.1');
    const [msg] = (await received) as [Buffer];
    expect(msg.toString()).toBe('hello');
    tx.close();
    rx.close();
  });

  it('blocks TCP connects to non-loopback hosts', () => {
    expect(() => net.connect(445, '192.0.2.1')).toThrow(NetworkGuardError);
    expect(() => net.connect({ host: '10.1.1.1', port: 3389 })).toThrow(NetworkGuardError);
  });

  it('blocks HTTP requests to non-loopback hosts', () => {
    // Regression: http passes `path: null`, which the first guard version mistook for IPC.
    expect(() => http.get('http://example.com/')).toThrow(NetworkGuardError);
  });

  it('allows TCP on loopback', async () => {
    const server = net.createServer((c) => c.end());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as net.AddressInfo;
    const sock = net.connect(port, '127.0.0.1');
    await once(sock, 'connect');
    sock.destroy();
    server.close();
  });
});
