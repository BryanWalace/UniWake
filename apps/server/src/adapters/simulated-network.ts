/**
 * Simulated LAN for demo mode (FR-015, constitution §2.5). Nothing here touches the network:
 * magic packets are only recorded, and a woken device "boots" after a random delay (≈ 10% never
 * do). Devices also switch on and off by themselves now and then, so the panel looks alive.
 */
import { MAGIC_PACKET_LENGTH, macOfPacket } from '../domain/magic-packet';
import type {
  Clock,
  DnsResolver,
  NetInterface,
  NetworkInterfaces,
  PacketSender,
  PacketSendRequest,
  Prober,
  ProbeOptions,
  ProbeResult,
} from '../application/ports';

export interface SimDevice {
  mac: string;
  ip: string | null;
  hostname: string | null;
}

export interface SimulatedNetworkOptions {
  clock: Clock;
  /** Current inventory (read on every probe; small in demo mode). */
  devices: () => SimDevice[];
  random?: () => number;
  /** Boot time after a magic packet, uniformly in [min, max]. */
  wakeDelayMs?: readonly [number, number];
  /** Chance per probe that a device switches on or off by itself. */
  driftPerProbe?: number;
}

/** The demo subnet: devices are seeded in 10.20.0.0/16. */
export const DEMO_INTERFACE: NetInterface = {
  name: 'Ethernet (demonstração)',
  address: '10.20.0.10',
  prefixLength: 16,
  netmask: '255.255.0.0',
  mac: '02:00:00:00:00:10',
  gateway: '10.20.0.1',
  internal: false,
};

interface SimState {
  on: boolean;
  bootAt: number | null;
}

/** Stable per-device traits from the MAC, so the same machines misbehave across restarts. */
function trait(mac: string): number {
  let h = 0;
  for (const c of mac) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 100;
}

export class SimulatedNetwork {
  private readonly state = new Map<string, SimState>();
  private readonly random: () => number;
  readonly packets: { mac: string; at: number; destination: string }[] = [];

  constructor(private readonly o: SimulatedNetworkOptions) {
    this.random = o.random ?? Math.random;
  }

  /** Never answers a magic packet (BIOS setting off, unplugged...). */
  static neverWakes(mac: string): boolean {
    return trait(mac) < 10;
  }

  /** Blocks ICMP; only TCP probes see it. */
  static blocksIcmp(mac: string): boolean {
    return trait(mac) >= 90;
  }

  setPower(mac: string, on: boolean): void {
    this.state.set(mac.toUpperCase(), { on, bootAt: null });
  }

  isOn(mac: string): boolean {
    const s = this.stateOf(mac.toUpperCase());
    return s.on;
  }

  private stateOf(mac: string): SimState {
    let s = this.state.get(mac);
    if (!s) {
      s = { on: this.random() < 0.5, bootAt: null };
      this.state.set(mac, s);
    }
    if (!s.on && s.bootAt !== null && this.o.clock.now() >= s.bootAt) {
      s.on = true;
      s.bootAt = null;
    }
    return s;
  }

  readonly interfaces: NetworkInterfaces = {
    list: () => Promise.resolve([{ ...DEMO_INTERFACE }]),
  };

  readonly sender: PacketSender = {
    send: (req: PacketSendRequest) => {
      const mac = req.payload.length === MAGIC_PACKET_LENGTH ? macOfPacket(req.payload) : null;
      if (mac) {
        this.packets.push({ mac, at: this.o.clock.now(), destination: req.destination });
        if (this.packets.length > 1000) this.packets.splice(0, this.packets.length - 1000);
        const s = this.stateOf(mac);
        if (!s.on && s.bootAt === null && !SimulatedNetwork.neverWakes(mac)) {
          const [min, max] = this.o.wakeDelayMs ?? [20_000, 120_000];
          s.bootAt = this.o.clock.now() + min + Math.round(this.random() * (max - min));
        }
      }
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  readonly prober: Prober = {
    probe: (addresses: readonly string[], _opts: ProbeOptions) => {
      const byIp = new Map<string, string>();
      for (const d of this.o.devices()) if (d.ip) byIp.set(d.ip, d.mac.toUpperCase());
      const out = new Map<string, ProbeResult>();
      const drift = this.o.driftPerProbe ?? 0.003;
      for (const a of addresses) {
        const mac = byIp.get(a);
        if (!mac) {
          out.set(a, { alive: false, via: null, latencyMs: null });
          continue;
        }
        const s = this.stateOf(mac);
        if (s.bootAt === null && this.random() < drift) {
          // Someone shut a machine down, or switched one on by hand.
          s.on = s.on ? false : !SimulatedNetwork.neverWakes(mac);
        }
        out.set(
          a,
          s.on
            ? {
                alive: true,
                via: SimulatedNetwork.blocksIcmp(mac) ? 'tcp' : 'icmp',
                latencyMs: 1 + Math.floor(this.random() * 12),
              }
            : { alive: false, via: null, latencyMs: null },
        );
      }
      return Promise.resolve(out);
    },
  };

  readonly dns: DnsResolver = {
    resolve4: (hostname: string) => {
      const d = this.o
        .devices()
        .find((x) => x.hostname !== null && x.hostname.toLowerCase() === hostname.toLowerCase());
      return d?.ip ? Promise.resolve([d.ip]) : Promise.reject(new Error(`ENOTFOUND ${hostname}`));
    },
  };
}
