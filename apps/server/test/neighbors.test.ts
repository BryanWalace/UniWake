import { describe, expect, it } from 'vitest';
import { dedupeNeighbors, parseArp, parseNetNeighborJson } from '../src/domain/neighbors';

// Same table in English and in Portuguese Windows. The pt-BR labels come in the console code
// page (CP850), so they reach the parser as mojibake: the parser must not care.
const ARP_EN = `
Interface: 10.0.3.5 --- 0xb
  Internet Address      Physical Address      Type
  10.0.3.1              00-1a-2b-3c-4d-01     dynamic
  10.0.3.41             00-1a-2b-3c-4d-41     dynamic
  10.0.3.255            ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static
  239.255.255.250       01-00-5e-7f-ff-fa     static

Interface: 192.168.56.1 --- 0x12
  Internet Address      Physical Address      Type
  192.168.56.101        08-00-27-aa-bb-cc     dynamic
  255.255.255.255       ff-ff-ff-ff-ff-ff     static
`;
const ARP_PT = ARP_EN.replace(
  /Internet Address {6}Physical Address {6}Type/g,
  'Endere\u0087o IP           Endere\u0087o f¡sico       Tipo',
)
  .replace(/dynamic/g, 'din\u0083mico ')
  .replace(/static/g, 'est tico');
const ARP_PT_DECODED = ARP_PT.replace(/[\u0080-ÿ]/g, '�'); // what a UTF-8 decode yields

describe('neighbor cache parsing (FR-101)', () => {
  it('AC-101-02: arp -a from pt-BR and en-US Windows parse identically', () => {
    const en = parseArp(ARP_EN);
    expect(en).toEqual([
      { ip: '10.0.3.1', mac: '00:1A:2B:3C:4D:01', interfaceIp: '10.0.3.5' },
      { ip: '10.0.3.41', mac: '00:1A:2B:3C:4D:41', interfaceIp: '10.0.3.5' },
      { ip: '192.168.56.101', mac: '08:00:27:AA:BB:CC', interfaceIp: '192.168.56.1' },
    ]);
    expect(parseArp(ARP_PT)).toEqual(en);
    expect(parseArp(ARP_PT_DECODED)).toEqual(en);
    expect(parseArp('')).toEqual([]);
  });

  it('reads Get-NetNeighbor JSON, one object or many, skipping unresolved entries', () => {
    const json = JSON.stringify([
      { IPAddress: '10.0.3.41', LinkLayerAddress: '00-1A-2B-3C-4D-41', State: 5 },
      { IPAddress: '10.0.3.42', LinkLayerAddress: '00-1A-2B-3C-4D-42', State: 'Stale' },
      { IPAddress: '10.0.3.43', LinkLayerAddress: '00-00-00-00-00-00', State: 0 },
      { IPAddress: '10.0.3.44', LinkLayerAddress: '00-1A-2B-3C-4D-44', State: 1 },
      { IPAddress: '10.0.3.255', LinkLayerAddress: 'FF-FF-FF-FF-FF-FF', State: 6 },
      { IPAddress: 'fe80::1', LinkLayerAddress: '00-1A-2B-3C-4D-45', State: 5 },
    ]);
    expect(parseNetNeighborJson(json).map((n) => n.ip)).toEqual(['10.0.3.41', '10.0.3.42']);
    expect(
      parseNetNeighborJson(
        JSON.stringify({ IPAddress: '10.0.3.9', LinkLayerAddress: '00-1A-2B-3C-4D-09', State: 4 }),
      ),
    ).toEqual([{ ip: '10.0.3.9', mac: '00:1A:2B:3C:4D:09', interfaceIp: null }]);
    expect(parseNetNeighborJson('  ')).toEqual([]);
  });

  it('keeps one entry per MAC, in IP order', () => {
    const list = dedupeNeighbors([
      { ip: '10.0.3.50', mac: '00:1A:2B:3C:4D:50', interfaceIp: null },
      { ip: '10.0.3.9', mac: '00:1A:2B:3C:4D:09', interfaceIp: null },
      { ip: '10.0.3.51', mac: '00:1A:2B:3C:4D:50', interfaceIp: null },
    ]);
    expect(list.map((n) => n.ip)).toEqual(['10.0.3.9', '10.0.3.51']);
  });
});

describe('Windows neighbor cache adapter (FR-101)', () => {
  it('uses the bundled Get-NetNeighbor script, falling back to arp.exe -a', async () => {
    const { WindowsNeighborCache } = await import('../src/adapters/neighbor-cache');
    const { FakeProcessRunner } = await import('./fakes/system-fakes');
    const runner = new FakeProcessRunner()
      .on('powershell.exe', {
        exitCode: 0,
        stdout: JSON.stringify([
          { IPAddress: '10.0.3.41', LinkLayerAddress: '00-1A-2B-3C-4D-41', State: 5 },
        ]),
        stderr: '',
      })
      .on('arp.exe', { exitCode: 0, stdout: ARP_EN, stderr: '' });
    const cache = new WindowsNeighborCache(
      runner,
      'C:\\UniWake\\helper\\get-neighbors.ps1',
      'C:\\Windows',
    );
    expect((await cache.read()).map((n) => n.ip)).toEqual(['10.0.3.41']);
    expect(runner.calls[0]).toMatchObject({
      file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\UniWake\\helper\\get-neighbors.ps1',
      ],
    });
    runner.on('powershell.exe', { exitCode: 1, stdout: '', stderr: 'Get-NetNeighbor not found' });
    expect((await cache.read()).map((n) => n.ip)).toEqual([
      '10.0.3.1',
      '10.0.3.41',
      '192.168.56.101',
    ]);
    expect(runner.calls.at(-1)).toMatchObject({
      file: 'C:\\Windows\\System32\\arp.exe',
      args: ['-a'],
    });
  });
});
