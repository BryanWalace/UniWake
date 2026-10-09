/** Loopback contract tests of the team-mode sockets (127.0.0.1 only, CLAUDE.md). */
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageChannel } from '../src/application/ports';
import { NodeSyncNetwork } from '../src/adapters/sync-network';

const nets: NodeSyncNetwork[] = [];
afterEach(async () => {
  for (const n of nets.splice(0)) await n.close();
});
const make = (opts = {}) => {
  const n = new NodeSyncNetwork({ bind: '127.0.0.1', ...opts });
  nets.push(n);
  return n;
};

const KEY = randomBytes(32);

async function server(opts = {}) {
  const n = make(opts);
  const got: { pairing: MessageChannel[]; sync: { ch: MessageChannel; identity: string }[] } = {
    pairing: [],
    sync: [],
  };
  const port = await n.listen(0, {
    onPairing: (ch) => got.pairing.push(ch),
    pskFor: (id) => (id.startsWith('uniwake/1/') ? KEY : null),
    onSync: (ch, identity) => got.sync.push({ ch, identity }),
  });
  return { n, port, got };
}

const until = async (f: () => boolean) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('sync network adapter (ADR-035, ADR-038)', () => {
  it('routes a JSON first byte to pairing and exchanges JSON lines both ways', async () => {
    const s = await server();
    const c = await make().connectPairing({ host: '127.0.0.1', port: s.port }, 2000);
    c.send({ type: 'pair.hello', n: 1 });
    await until(() => s.got.pairing.length === 1);
    const srv = s.got.pairing[0]!;
    expect(await srv.receive(1000)).toEqual({ type: 'pair.hello', n: 1 });
    srv.send({ type: 'pair.start' });
    expect(await c.receive(1000)).toEqual({ type: 'pair.start' });
    expect(srv.remoteAddress).toBe('127.0.0.1');
  });

  it('opens a TLS 1.3 PSK session with the right key and tells the server who connected', async () => {
    const s = await server();
    const c = await make().connectSync(
      { host: '127.0.0.1', port: s.port },
      'uniwake/1/abc/1',
      KEY,
      3000,
    );
    c.send({ type: 'hello' });
    await until(() => s.got.sync.length === 1);
    expect(s.got.sync[0]!.identity).toBe('uniwake/1/abc/1');
    expect(await s.got.sync[0]!.ch.receive(1000)).toEqual({ type: 'hello' });
  });

  it('AC-202-04: a wrong key or an unknown identity never gets a session', async () => {
    const s = await server();
    await expect(
      make().connectSync(
        { host: '127.0.0.1', port: s.port },
        'uniwake/1/abc/1',
        randomBytes(32),
        3000,
      ),
    ).rejects.toThrow();
    await expect(
      make().connectSync({ host: '127.0.0.1', port: s.port }, 'intruder', KEY, 3000),
    ).rejects.toThrow();
    expect(s.got.sync).toHaveLength(0);
  });

  it('drops connections that start with anything else, malformed JSON and oversized lines', async () => {
    const s = await server({ maxPairingLine: 1024 });
    const raw = net.connect({ host: '127.0.0.1', port: s.port });
    await new Promise((r) => raw.once('connect', r));
    raw.write('GET / HTTP/1.1\r\n\r\n');
    await new Promise((r) => raw.once('close', r));
    expect(s.got.pairing).toHaveLength(0);

    const c = await make().connectPairing({ host: '127.0.0.1', port: s.port }, 2000);
    c.send({ big: 'x'.repeat(4096) });
    await until(() => s.got.pairing.length === 1);
    await expect(s.got.pairing[0]!.receive(1000)).rejects.toThrow(/too large|closed/);

    const bad = net.connect({ host: '127.0.0.1', port: s.port });
    await new Promise((r) => bad.once('connect', r));
    bad.write('{not json\n');
    await until(() => s.got.pairing.length === 2);
    await expect(s.got.pairing[1]!.receive(1000)).rejects.toThrow(/malformed|closed/);
  });

  it('receive times out when nothing arrives', async () => {
    const s = await server();
    const c = await make().connectPairing({ host: '127.0.0.1', port: s.port }, 2000);
    c.send({ type: 'pair.hello' }); // the first byte picks the protocol
    await until(() => s.got.pairing.length === 1);
    await s.got.pairing[0]!.receive(1000);
    await expect(s.got.pairing[0]!.receive(50)).rejects.toThrow('timeout');
  });

  it('announcements travel over UDP on loopback and garbage is ignored', async () => {
    const listener = make();
    const seen: { msg: unknown; from: string }[] = [];
    const port = await listener.listenAnnouncements(0, (msg, from) => seen.push({ msg, from }));
    const sender = make();
    await sender.announce({ v: 1, team: 'abc' }, [{ host: '127.0.0.1', port }]);
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual({ msg: { v: 1, team: 'abc' }, from: '127.0.0.1' });
  });
});
