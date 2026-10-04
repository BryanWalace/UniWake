/**
 * Wake verification probes (FR-003.5). Probes the job's devices directly instead of reading the
 * last sweep's cached status (phase-1 D1-03). Devices are addressed by IP, or by hostname resolved
 * through DNS when they have no IP.
 */
import type { DnsResolver, Prober } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export interface VerifyTarget {
  deviceId: number;
  ip: string | null;
  hostname: string | null;
}

export interface Verifier {
  /** Device ids that answered. Never rejects for individual failures. */
  check(targets: readonly VerifyTarget[]): Promise<Set<number>>;
}

export const hasAddress = (t: VerifyTarget) => t.ip !== null || t.hostname !== null;

export class ProberVerifier implements Verifier {
  constructor(
    private readonly prober: Prober,
    private readonly dns: DnsResolver,
    private readonly settings: SettingsService,
  ) {}

  async check(targets: readonly VerifyTarget[]): Promise<Set<number>> {
    const byAddress = new Map<string, number[]>();
    await Promise.all(
      targets.map(async (t) => {
        let address = t.ip;
        if (!address && t.hostname) {
          address = (await this.dns.resolve4(t.hostname).catch(() => []))[0] ?? null;
        }
        if (!address) return;
        byAddress.set(address, [...(byAddress.get(address) ?? []), t.deviceId]);
      }),
    );
    const alive = new Set<number>();
    if (byAddress.size === 0) return alive;
    const results = await this.prober.probe([...byAddress.keys()], {
      icmpTimeoutMs: this.settings.get('monitor.icmpTimeoutMs'),
      tcpPorts: this.settings.get('monitor.tcpPorts'),
      tcpTimeoutMs: this.settings.get('monitor.tcpTimeoutMs'),
    });
    for (const [address, r] of results) {
      if (r.alive) for (const id of byAddress.get(address) ?? []) alive.add(id);
    }
    return alive;
  }
}
