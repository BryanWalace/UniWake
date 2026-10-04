import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  OsNetworkInterfaces,
  parseProcNetRoute,
  parseRoutePrint,
} from '../src/adapters/network-interfaces';
import { NodeProcessRunner, ProcessTimeoutError } from '../src/adapters/process-runner';
import { selectInterfaces } from '../src/domain/network';
import { FakeProcessRunner } from './fakes/system-fakes';

const ROUTE_PRINT_EN = `===========================================================================
Interface List
 11...d8 5e d3 f6 34 6c ......Intel(R) Ethernet Connection (7) I219-V
 23...00 ff 1a 2b 3c 4d ......FortiClient VPN
 15...00 15 5d 01 02 03 ......Hyper-V Virtual Ethernet Adapter
  1...........................Software Loopback Interface 1
===========================================================================

IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0       10.0.3.1      10.0.3.15     25
          0.0.0.0          0.0.0.0     10.200.0.1    10.200.0.25      1
          0.0.0.0          0.0.0.0       10.0.3.254    10.0.3.15     50
         10.0.3.0    255.255.255.0         On-link      10.0.3.15    281
        127.0.0.0        255.0.0.0         On-link       127.0.0.1    331
     172.20.0.0    255.255.240.0         On-link     172.20.0.1   5256
===========================================================================
Persistent Routes:
  Network Address          Netmask  Gateway Address  Metric
          0.0.0.0          0.0.0.0         10.0.3.1  Default
===========================================================================
`;

const ROUTE_PRINT_PT = `===========================================================================
Lista de interfaces
 11...d8 5e d3 f6 34 6c ......Conexão Ethernet Intel(R)
===========================================================================

Tabela de rotas IPv4
===========================================================================
Rotas ativas:
Destino de rede    Máscara de rede      Gateway       Interface   Métrica
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.167     25
      192.168.0.0    255.255.255.0       No vínculo     192.168.0.167    281
===========================================================================
Rotas persistentes:
  Nenhuma
`;

describe('route print parsing (ADR-019)', () => {
  it('maps interface IP → default gateway, lowest metric wins, ignoring persistent routes', () => {
    expect(Object.fromEntries(parseRoutePrint(ROUTE_PRINT_EN))).toEqual({
      '10.0.3.15': '10.0.3.1',
      '10.200.0.25': '10.200.0.1',
    });
  });

  it('works on pt-BR Windows (localized headers, "No vínculo")', () => {
    expect(Object.fromEntries(parseRoutePrint(ROUTE_PRINT_PT))).toEqual({
      '192.168.0.167': '192.168.0.1',
    });
    expect(parseRoutePrint('').size).toBe(0);
  });

  it('parses Linux /proc/net/route default routes', () => {
    const text =
      'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n' +
      'eth0\t00000000\t0103000A\t0003\t0\t0\t100\t00000000\t0\t0\t0\n' +
      'eth0\t0003000A\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0\n' +
      'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n';
    expect(Object.fromEntries(parseProcNetRoute(text))).toEqual({ eth0: '10.0.3.1' });
  });
});

const info = (
  address: string,
  netmask: string,
  mac: string,
  internal = false,
): NetworkInterfaceInfo => ({
  address,
  netmask,
  family: 'IPv4',
  mac,
  internal,
  cidr: null,
});

describe('OsNetworkInterfaces adapter', () => {
  const osList = (): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
    Ethernet: [
      info('10.0.3.15', '255.255.255.0', 'd8:5e:d3:f6:34:6c'),
      { ...info('fe80::1', 'ffff::', 'd8:5e:d3:f6:34:6c'), family: 'IPv6' as const, scopeid: 0 },
    ],
    'FortiClient VPN': [info('10.200.0.25', '255.255.255.255', '00:ff:1a:2b:3c:4d')],
    'vEthernet (Default Switch)': [info('172.20.0.1', '255.255.240.0', '00:15:5d:01:02:03')],
    'Loopback Pseudo-Interface 1': [info('127.0.0.1', '255.0.0.0', '00:00:00:00:00:00', true)],
  });

  it('on Windows combines os interfaces with gateways from route print', async () => {
    const runner = new FakeProcessRunner().on('route.exe', {
      exitCode: 0,
      stdout: ROUTE_PRINT_EN,
      stderr: '',
    });
    const nics = new OsNetworkInterfaces(runner, {
      platform: 'win32',
      list: osList,
      systemRoot: 'C:\\Windows',
    });
    const list = await nics.list();
    expect(list.find((i) => i.name === 'Ethernet')).toEqual({
      name: 'Ethernet',
      address: '10.0.3.15',
      prefixLength: 24,
      netmask: '255.255.255.0',
      mac: 'D8:5E:D3:F6:34:6C',
      gateway: '10.0.3.1',
      internal: false,
    });
    expect(list).toHaveLength(4); // IPv6 dropped
    expect(runner.calls[0]).toMatchObject({
      file: 'C:\\Windows\\System32\\route.exe',
      args: ['print', '-4'],
    });
    // VPN has a /32 and Hyper-V has no gateway: the default selection keeps Ethernet (+ VPN, which has one)
    expect(selectInterfaces(list, []).map((i) => i.name)).toEqual(['Ethernet', 'FortiClient VPN']);
  });

  it('elsewhere reads /proc/net/route; on failure reports no gateways instead of throwing', async () => {
    const linux = new OsNetworkInterfaces(new FakeProcessRunner(), {
      platform: 'linux',
      list: () => ({ eth0: [info('10.0.3.15', '255.255.255.0', '00:11:22:33:44:55')] }),
      readProcRoute: () =>
        Promise.resolve(
          'Iface\tDestination\tGateway\n eth0\t00000000\t0103000A\t0003\t0\t0\t100\t00000000\n',
        ),
    });
    expect((await linux.list())[0]?.gateway).toBe('10.0.3.1');

    const broken = new OsNetworkInterfaces(new FakeProcessRunner(), {
      platform: 'win32',
      list: osList,
    });
    const list = await broken.list(); // runner has no responder → rejects
    expect(list.every((i) => i.gateway === null)).toBe(true);
  });
});

describe('NodeProcessRunner (plan §9.1)', () => {
  const runner = new NodeProcessRunner();

  it('runs an executable with an argument array (no shell) and captures output and exit code', async () => {
    const r = await runner.run(process.execPath, [
      '-e',
      'process.stdout.write("olá " + process.argv[1]); process.exit(3)',
      '& echo injected',
    ]);
    expect(r).toEqual({ exitCode: 3, stdout: 'olá & echo injected', stderr: '' });
  });

  it('passes stdin and enforces the timeout', async () => {
    const echo = await runner.run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
      stdin: '{"a":1}',
    });
    expect(echo.stdout).toBe('{"a":1}');
    await expect(
      runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 }),
    ).rejects.toBeInstanceOf(ProcessTimeoutError);
  });

  it('rejects when the executable does not exist', async () => {
    await expect(runner.run('C:\\nao\\existe.exe', [])).rejects.toThrow();
  });
});
