import type {
  DnsResolver,
  NetInterface,
  NetworkInterfaces,
  PacketSender,
  PacketSendRequest,
  Prober,
  ProbeOptions,
  ProbeResult,
} from '../../src/application/ports';
import type { FakeClock } from './fake-clock';
import { FaultPlan } from './faults';

export interface SentPacket extends PacketSendRequest {
  at: number;
}

/** Records every packet; never touches the network. */
export class FakePacketSender implements PacketSender {
  readonly sent: SentPacket[] = [];
  readonly faults = new FaultPlan<PacketSendRequest>();
  closed = false;

  constructor(private readonly clock?: FakeClock) {}

  send(req: PacketSendRequest): Promise<void> {
    try {
      this.faults.check(req);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    this.sent.push({ ...req, payload: Uint8Array.from(req.payload), at: this.clock?.now() ?? 0 });
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  /** Distinct MACs found in sent magic packets (bytes 6..11). */
  macsSent(): Set<string> {
    const macs = new Set<string>();
    for (const p of this.sent) {
      const bytes = [...p.payload.slice(6, 12)];
      macs.add(bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':'));
    }
    return macs;
  }
}

export function iface(partial: Partial<NetInterface> & { address: string }): NetInterface {
  return {
    name: 'Ethernet',
    prefixLength: 24,
    netmask: '255.255.255.0',
    mac: '00:11:22:33:44:55',
    gateway: null,
    internal: false,
    ...partial,
  };
}

export class FakeNetworkInterfaces implements NetworkInterfaces {
  readonly faults = new FaultPlan<void>();
  constructor(public interfaces: NetInterface[] = []) {}

  list(): Promise<NetInterface[]> {
    try {
      this.faults.check(undefined);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    return Promise.resolve(this.interfaces.map((i) => ({ ...i })));
  }
}

/** Scriptable prober: addresses are offline unless marked alive. */
export class FakeProber implements Prober {
  private alive = new Map<string, ProbeResult>();
  readonly faults = new FaultPlan<readonly string[]>();
  readonly calls: { addresses: string[]; opts: ProbeOptions }[] = [];

  setAlive(address: string, via: ProbeResult['via'] = 'icmp', latencyMs = 1): void {
    this.alive.set(address, { alive: true, via, latencyMs });
  }

  setOffline(address: string): void {
    this.alive.delete(address);
  }

  probe(addresses: readonly string[], opts: ProbeOptions): Promise<Map<string, ProbeResult>> {
    this.calls.push({ addresses: [...addresses], opts });
    try {
      this.faults.check(addresses);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const out = new Map<string, ProbeResult>();
    for (const a of addresses) {
      out.set(a, this.alive.get(a) ?? { alive: false, via: null, latencyMs: null });
    }
    return Promise.resolve(out);
  }
}

export class FakeDnsResolver implements DnsResolver {
  readonly records = new Map<string, string[]>();
  /** Reverse lookups (discovery); absent = not supported, like a resolver without it. */
  reverse?: (ip: string) => Promise<string[]>;
  readonly faults = new FaultPlan<string>();
  lookups = 0;

  resolve4(hostname: string): Promise<string[]> {
    this.lookups++;
    try {
      this.faults.check(hostname);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const r = this.records.get(hostname.toLowerCase());
    return r ? Promise.resolve([...r]) : Promise.reject(new Error(`ENOTFOUND ${hostname}`));
  }
}
