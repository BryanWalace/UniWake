import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { macOfPacket, magicPacket } from '../src/domain/magic-packet';
import {
  intToIp,
  ipToInt,
  LIMITED_BROADCAST,
  type NetInterface,
  prefixFromNetmask,
  routesFor,
  sameSubnet,
  selectInterfaces,
  subnetBroadcast,
} from '../src/domain/network';

const nic = (p: Partial<NetInterface> & { address: string }): NetInterface => ({
  name: 'Ethernet',
  prefixLength: 24,
  netmask: '255.255.255.0',
  mac: '00:11:22:33:44:55',
  gateway: null,
  internal: false,
  ...p,
});

describe('magic packet (FR-003.1)', () => {
  it('AC-003-01 is 102 bytes: 6 × FF then 16 repetitions of the MAC', () => {
    const p = magicPacket('01:23:45:67:89:AB'.replace('01', '00'));
    expect(p).toHaveLength(102);
    expect([...p.slice(0, 6)]).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const mac = [0x00, 0x23, 0x45, 0x67, 0x89, 0xab];
    for (let i = 0; i < 16; i++)
      expect([...p.slice(6 + i * 6, 12 + i * 6)], `rep ${i}`).toEqual(mac);
    expect(macOfPacket(p)).toBe('00:23:45:67:89:AB');
  });

  it('accepts any MAC format and rejects invalid ones', () => {
    expect(macOfPacket(magicPacket('aa-bb-cc-dd-ee-f0'.replace('aa', 'a8')))).toBe(
      'A8:BB:CC:DD:EE:F0',
    );
    expect(() => magicPacket('nope')).toThrow();
  });
});

describe('IPv4 helpers', () => {
  it('round-trips integers and computes prefixes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (n) => {
        expect(ipToInt(intToIp(n))).toBe(n);
      }),
    );
    expect(prefixFromNetmask('255.255.254.0')).toBe(23);
    expect(prefixFromNetmask('255.255.255.255')).toBe(32);
    expect(prefixFromNetmask('0.0.0.0')).toBe(0);
    expect(() => ipToInt('10.0.0.256')).toThrow();
  });

  it('computes subnet broadcasts', () => {
    expect(subnetBroadcast('10.0.3.15', 24)).toBe('10.0.3.255');
    expect(subnetBroadcast('10.0.4.20', 23)).toBe('10.0.5.255');
    expect(subnetBroadcast('172.16.10.1', 12)).toBe('172.31.255.255');
    expect(subnetBroadcast('10.0.0.1', 31)).toBeNull();
    expect(subnetBroadcast('10.0.0.1', 32)).toBeNull();
    expect(sameSubnet('10.0.3.15', '10.0.3.200', 24)).toBe(true);
    expect(sameSubnet('10.0.3.15', '10.0.9.5', 24)).toBe(false);
    expect(sameSubnet('1.2.3.4', '5.6.7.8', 0)).toBe(true);
  });
});

describe('interface selection (FR-003.2, D1-04)', () => {
  const eth = nic({ name: 'Ethernet', address: '10.0.3.15', gateway: '10.0.3.1' });
  const hyperv = nic({
    name: 'vEthernet (Default Switch)',
    address: '172.20.0.1',
    prefixLength: 20,
  });
  const vbox = nic({ name: 'VirtualBox Host-Only', address: '192.168.56.1' });
  const apipa = nic({
    name: 'Ethernet 2',
    address: '169.254.10.5',
    prefixLength: 16,
    gateway: '169.254.0.1',
  });
  const lo = nic({ name: 'Loopback', address: '127.0.0.1', prefixLength: 8, internal: true });

  it('by default uses only interfaces with a gateway, never loopback or APIPA', () => {
    expect(selectInterfaces([eth, hyperv, vbox, apipa, lo], []).map((i) => i.name)).toEqual([
      'Ethernet',
    ]);
  });

  it('configured addresses override the default (still never loopback/APIPA)', () => {
    expect(
      selectInterfaces([eth, vbox, apipa], ['192.168.56.1', '169.254.10.5']).map((i) => i.address),
    ).toEqual(['192.168.56.1']);
    expect(selectInterfaces([eth], ['10.9.9.9'])).toEqual([]);
  });
});

describe('send routes (FR-003.2)', () => {
  it('AC-003-02 each interface sends to 255.255.255.255 and its own subnet broadcast', () => {
    const a = nic({ address: '10.0.3.15', prefixLength: 24, gateway: '10.0.3.1' });
    const b = nic({
      name: 'Ethernet 2',
      address: '10.0.4.20',
      prefixLength: 23,
      gateway: '10.0.4.1',
    });
    expect(routesFor([a, b], null)).toEqual([
      { sourceIp: '10.0.3.15', destination: LIMITED_BROADCAST },
      { sourceIp: '10.0.3.15', destination: '10.0.3.255' },
      { sourceIp: '10.0.4.20', destination: LIMITED_BROADCAST },
      { sourceIp: '10.0.4.20', destination: '10.0.5.255' },
    ]);
  });

  it('AC-003-03 a room directed broadcast is added via interfaces with a gateway, without duplicates', () => {
    const a = nic({ address: '10.0.3.15', gateway: '10.0.3.1' });
    const noGw = nic({ name: 'Lab', address: '192.168.10.2' });
    expect(routesFor([a, noGw], '10.0.7.255')).toContainEqual({
      sourceIp: '10.0.3.15',
      destination: '10.0.7.255',
    });
    expect(
      routesFor([a, noGw], '10.0.7.255').filter((r) => r.destination === '10.0.7.255'),
    ).toHaveLength(1);
    // directed broadcast equal to an interface's own broadcast is not duplicated
    expect(routesFor([a], '10.0.3.255')).toHaveLength(2);
    // with no gateway anywhere, it still goes out (from every interface)
    expect(routesFor([noGw], '10.0.7.255')).toContainEqual({
      sourceIp: '192.168.10.2',
      destination: '10.0.7.255',
    });
  });

  it('no interfaces → no routes', () => {
    expect(routesFor([], '10.0.7.255')).toEqual([]);
  });
});
