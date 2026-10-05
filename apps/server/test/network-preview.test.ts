import { afterEach, describe, expect, it } from 'vitest';
import type { NetworkPreview } from '../src/application/network/network-preview';
import { iface } from './fakes/network-fakes';
import { apiHarness, type ApiHarness } from './helpers/api';

const hs: ApiHarness[] = [];
afterEach(async () => {
  for (const h of hs.splice(0)) await h.close();
});

describe('network settings preview (FR-011)', () => {
  it('AC-011-01: with the interfaces of AC-003-02 the preview lists exactly those destinations', async () => {
    const h = await apiHarness();
    hs.push(h);
    h.ports.interfaces.interfaces = [
      iface({ name: 'Ethernet', address: '10.0.3.15', prefixLength: 24, gateway: '10.0.3.1' }),
      iface({ name: 'Ethernet 2', address: '10.0.4.20', prefixLength: 23, gateway: '10.0.4.1' }),
      iface({ name: 'vEthernet (WSL)', address: '172.20.0.1', prefixLength: 20 }),
      iface({ name: 'Wi-Fi', address: '169.254.10.2', prefixLength: 16, gateway: '169.254.0.1' }),
    ];
    h.services.rooms.create(
      { name: 'Lab Remoto', directedBroadcast: '10.0.7.255' },
      { id: null, label: 't' },
    );
    const r = await h.inject({ url: '/api/network/interfaces', cookie: await h.as('admin') });
    expect(r.statusCode).toBe(200);
    const p = r.json<NetworkPreview>();
    expect(p.destinations).toEqual([
      { sourceIp: '10.0.3.15', destination: '255.255.255.255' },
      { sourceIp: '10.0.3.15', destination: '10.0.3.255' },
      { sourceIp: '10.0.4.20', destination: '255.255.255.255' },
      { sourceIp: '10.0.4.20', destination: '10.0.5.255' },
    ]);
    expect(p.ports).toEqual([9, 7]);
    expect(p.interfaces.map((i) => [i.address, i.selected])).toEqual([
      ['10.0.3.15', true],
      ['10.0.4.20', true],
      ['172.20.0.1', false],
      ['169.254.10.2', false],
    ]);
    expect(p.interfaces[2]!.reason).toMatch(/sem gateway/);
    expect(p.interfaces[3]!.reason).toMatch(/169\.254/);
    expect(p.rooms).toEqual([
      {
        roomId: expect.any(Number),
        name: 'Lab Remoto',
        destinations: [
          { sourceIp: '10.0.3.15', destination: '10.0.7.255' },
          { sourceIp: '10.0.4.20', destination: '10.0.7.255' },
        ],
      },
    ]);
  });

  it('configured interfaces win, and operators cannot see the preview', async () => {
    const h = await apiHarness();
    hs.push(h);
    h.ports.interfaces.interfaces = [
      iface({ address: '10.0.3.15', gateway: '10.0.3.1' }),
      iface({ address: '10.0.9.9', gateway: null }),
    ];
    h.services.settings.update({ 'wake.interfaces': ['10.0.9.9'] }, null);
    const p = (
      await h.inject({ url: '/api/network/interfaces', cookie: await h.as('admin') })
    ).json<NetworkPreview>();
    expect(p.interfaces.map((i) => i.selected)).toEqual([false, true]);
    expect(p.interfaces[0]!.reason).toBe('não está na lista de interfaces configuradas');
    expect(
      (await h.inject({ url: '/api/network/interfaces', cookie: await h.as('operator') }))
        .statusCode,
    ).toBe(403);
  });
});
