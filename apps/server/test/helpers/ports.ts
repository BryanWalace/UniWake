import type { Neighbor } from '../../src/domain/neighbors';
import type { ServicePorts } from '../../src/services';
import type { FakeClock } from '../fakes/fake-clock';
import {
  FakeDnsResolver,
  FakeNetworkInterfaces,
  FakePacketSender,
  FakeProber,
  iface,
} from '../fakes/network-fakes';
import { MemoryLogger } from '../fakes/system-fakes';

export interface FakePorts extends ServicePorts {
  interfaces: FakeNetworkInterfaces;
  sender: FakePacketSender;
  dryRunSender: FakePacketSender;
  prober: FakeProber;
  dns: FakeDnsResolver;
  logger: MemoryLogger;
  /** Scriptable ARP cache for discovery: set `entries`. */
  neighbors: { entries: Neighbor[]; read(): Promise<Neighbor[]> };
}

/** One wired NIC 10.0.3.15/24 with a gateway, recording senders, scriptable prober and DNS. */
export function fakePorts(clock: FakeClock): FakePorts {
  return {
    interfaces: new FakeNetworkInterfaces([
      iface({ name: 'Ethernet', address: '10.0.3.15', prefixLength: 24, gateway: '10.0.3.1' }),
    ]),
    sender: new FakePacketSender(clock),
    dryRunSender: new FakePacketSender(clock),
    prober: new FakeProber(),
    dns: new FakeDnsResolver(),
    logger: new MemoryLogger(),
    neighbors: {
      entries: [],
      read() {
        return Promise.resolve([...this.entries]);
      },
    },
  };
}
