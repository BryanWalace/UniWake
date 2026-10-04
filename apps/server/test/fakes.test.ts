import { describe, expect, it } from 'vitest';
import { FakeClock } from './fakes/fake-clock';
import { errnoError } from './fakes/faults';
import {
  FakeDnsResolver,
  FakeNetworkInterfaces,
  FakePacketSender,
  FakeProber,
  iface,
} from './fakes/network-fakes';
import { FakeFileSystem, FakeProcessRunner, MemoryLogger } from './fakes/system-fakes';

describe('FakeClock', () => {
  it('fires timers in time order, FIFO for equal times, including timers added while advancing', () => {
    const clock = new FakeClock(0);
    const order: string[] = [];
    clock.setTimeout(() => order.push('b@20'), 20);
    clock.setTimeout(() => order.push('a@10'), 10);
    clock.setTimeout(() => {
      order.push('c@10');
      clock.setTimeout(() => order.push('d@15'), 5);
    }, 10);
    clock.advance(25);
    expect(order).toEqual(['a@10', 'c@10', 'd@15', 'b@20']);
    expect(clock.now()).toBe(25);
  });

  it('clearTimeout cancels; jump changes time without firing', () => {
    const clock = new FakeClock(1000);
    let fired = 0;
    const h = clock.setTimeout(() => fired++, 10);
    clock.setTimeout(() => fired++, 100);
    clock.clearTimeout(h);
    clock.jump(500);
    expect(fired).toBe(0);
    expect(clock.now()).toBe(1500);
    clock.advance(99); // timers are monotonic: the 100 ms timer still needs its full delay
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
    expect(clock.now()).toBe(1600);
  });

  it('advanceAsync drives async loops that await sleep()', async () => {
    const clock = new FakeClock(0);
    const ticks: number[] = [];
    const loop = (async () => {
      for (let i = 0; i < 3; i++) {
        await clock.sleep(1000);
        ticks.push(clock.now());
      }
    })();
    await clock.advanceAsync(3000);
    await loop;
    expect(ticks).toEqual([1000, 2000, 3000]);
  });
});

describe('fault injection', () => {
  it('sender fails the Nth call and records the rest', async () => {
    const sender = new FakePacketSender();
    sender.faults.failNth(2, errnoError('EADDRNOTAVAIL'));
    const req = {
      sourceIp: '10.0.0.5',
      destination: '10.0.0.255',
      port: 9,
      payload: new Uint8Array(102),
    };
    await sender.send(req);
    await expect(sender.send(req)).rejects.toMatchObject({ code: 'EADDRNOTAVAIL' });
    await sender.send(req);
    expect(sender.sent).toHaveLength(2);
    expect(sender.faults.callCount).toBe(3);
  });

  it('sender failWhen matches by argument; macsSent decodes magic packets', async () => {
    const sender = new FakePacketSender();
    sender.faults.failWhen((r) => r.sourceIp === '192.168.56.1');
    const payload = new Uint8Array(102).fill(0xff);
    payload.set([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e], 6);
    await sender.send({ sourceIp: '10.0.0.5', destination: '255.255.255.255', port: 9, payload });
    await expect(
      sender.send({ sourceIp: '192.168.56.1', destination: '255.255.255.255', port: 9, payload }),
    ).rejects.toThrow('injected fault');
    expect([...sender.macsSent()]).toEqual(['00:1A:2B:3C:4D:5E']);
  });

  it('interfaces can fail next calls; prober and DNS are scriptable', async () => {
    const nics = new FakeNetworkInterfaces([iface({ address: '10.0.0.5', gateway: '10.0.0.1' })]);
    nics.faults.failNext(1);
    await expect(nics.list()).rejects.toThrow();
    expect(await nics.list()).toHaveLength(1);

    const prober = new FakeProber();
    prober.setAlive('10.0.0.20', 'tcp-refused', 3);
    const r = await prober.probe(['10.0.0.20', '10.0.0.21'], {
      icmpTimeoutMs: 1000,
      tcpPorts: [445],
      tcpTimeoutMs: 800,
    });
    expect(r.get('10.0.0.20')).toEqual({ alive: true, via: 'tcp-refused', latencyMs: 3 });
    expect(r.get('10.0.0.21')?.alive).toBe(false);

    const dns = new FakeDnsResolver();
    dns.records.set('pc-01', ['10.0.0.31']);
    expect(await dns.resolve4('PC-01')).toEqual(['10.0.0.31']);
    await expect(dns.resolve4('nope')).rejects.toThrow('ENOTFOUND');
  });

  it('file system, process runner and logger fakes', async () => {
    const fs = new FakeFileSystem();
    await fs.writeText('/data/a.txt', 'olá');
    expect(await fs.readText('/data/a.txt')).toBe('olá');
    expect(await fs.size('/data/a.txt')).toBe(4);
    expect(await fs.list('/data')).toEqual(['a.txt']);
    fs.faults.failWhen((a) => a.op === 'write');
    await expect(fs.writeText('/data/b.txt', 'x')).rejects.toThrow();
    await expect(fs.readText('/nope')).rejects.toMatchObject({ code: 'ENOENT' });

    const runner = new FakeProcessRunner().on('C:\\Windows\\System32\\route.exe', {
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    });
    expect((await runner.run('C:\\Windows\\System32\\ROUTE.EXE', ['print', '-4'])).stdout).toBe(
      'ok',
    );
    expect(runner.calls[0]?.args).toEqual(['print', '-4']);
    await expect(runner.run('powershell.exe', [])).rejects.toThrow('no responder');

    const log = new MemoryLogger();
    log.child({ module: 'wake' }).info({ jobId: 1 }, 'started');
    expect(log.text()).toContain('"module":"wake"');
  });
});
