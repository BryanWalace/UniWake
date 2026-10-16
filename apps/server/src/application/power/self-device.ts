/**
 * FR-501.5: which inventory devices are the PC this hub runs on (by MAC or IPv4 of its network
 * interfaces), so a shutdown that includes it is announced instead of happening by surprise.
 */
import type { NetworkInterfaces } from '../ports';

export interface SelfDeviceDeps {
  interfaces: NetworkInterfaces;
  /** Devices whose MAC or IP is one of these. */
  devicesMatching: (macs: readonly string[], ips: readonly string[]) => number[];
}

export class SelfDeviceService {
  constructor(private readonly d: SelfDeviceDeps) {}

  async ids(): Promise<Set<number>> {
    try {
      const own = (await this.d.interfaces.list()).filter((i) => !i.internal);
      const macs = own.map((i) => i.mac.toUpperCase()).filter((m) => m !== '00:00:00:00:00:00');
      return new Set(
        this.d.devicesMatching(
          macs,
          own.map((i) => i.address),
        ),
      );
    } catch {
      return new Set(); // no interface list: never block a shutdown on it
    }
  }
}
