/**
 * Network discovery (FR-101). A sweep of one of this computer's subnets (probes fill the neighbor
 * cache), then the cache is read and each answer listed with vendor, host name, latency, first and
 * last seen, "já cadastrado" and the locally-administered flag. Only this computer's own subnets can
 * be swept: the neighbor cache sees nothing beyond them, and it keeps discovery from scanning
 * networks it was not meant to. Bulk add creates the chosen machines in a room.
 */
import {
  DISCOVERY_CONFIRM_HOSTS,
  DISCOVERY_MAX_HOSTS,
  type DiscoveredDevice,
  type DiscoveryAddResult,
  type DiscoveryState,
  isLocallyAdministered,
} from '@uniwake/shared';
import {
  type Cidr,
  cidrOf,
  contains,
  formatCidr,
  hostsOf,
  parseCidr,
  within,
} from '../../domain/cidr';
import { isApipa, isLoopback } from '../../domain/network';
import type { Neighbor } from '../../domain/neighbors';
import { type OuiTable, vendorOf } from '../../domain/oui';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock, DnsResolver, Logger, NetworkInterfaces, Prober } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export interface NeighborCache {
  read(): Promise<Neighbor[]>;
}

export interface DiscoveryDeps {
  prober: Prober;
  neighbors: NeighborCache;
  dns: DnsResolver;
  interfaces: NetworkInterfaces;
  oui: () => OuiTable;
  findByMac: (mac: string) => { id: number; name: string } | undefined;
  roomName: (id: number) => string | undefined;
  createDevice: (
    d: { name: string; mac: string; ip: string; hostname: string | null; roomId: number | null },
    actor: Actor,
  ) => void;
  transaction: <T>(fn: () => T) => T;
  settings: SettingsService;
  audit: AuditService;
  clock: Clock;
  logger: Logger;
}

const BATCH = 256;
const DNS_CONCURRENCY = 32;

export class DiscoveryService {
  private state: Omit<DiscoveryState, 'subnets'> = {
    state: 'idle',
    cidr: null,
    startedAt: null,
    finishedAt: null,
    probed: 0,
    total: 0,
    error: null,
    found: [],
  };
  private readonly seen = new Map<string, { first: number; last: number }>();

  constructor(private readonly d: DiscoveryDeps) {}

  private get running(): boolean {
    return this.state.state === 'running';
  }

  private async subnets(): Promise<{ name: string; cidr: string; hosts: number }[]> {
    const out = new Map<string, { name: string; cidr: string; hosts: number }>();
    for (const i of await this.d.interfaces.list()) {
      if (i.internal || isLoopback(i.address) || isApipa(i.address)) continue;
      const cidr = cidrOf(i.address, i.prefixLength);
      out.set(cidr, { name: i.name, cidr, hosts: parseCidr(cidr)!.hosts });
    }
    return [...out.values()];
  }

  async status(): Promise<DiscoveryState> {
    return { ...this.state, found: [...this.state.found], subnets: await this.subnets() };
  }

  /** Starts a sweep (or returns the one running). */
  async scan(req: { cidr: string; confirmLarge?: boolean }, actor: Actor): Promise<DiscoveryState> {
    if (this.running) return this.status();
    const cidr = parseCidr(req.cidr);
    const invalid = (message: string) =>
      new AppError('VALIDATION_FAILED', {}, [{ path: 'cidr', message }]);
    if (!cidr) throw invalid('Use o formato 10.0.3.0/24.');
    const own = (await this.subnets()).map((s) => parseCidr(s.cidr)!);
    // Another request may have started a sweep while the interfaces were read.
    if (this.running) return this.status();
    if (!own.some((o) => within(cidr, o))) {
      throw invalid(
        'A descoberta só enxerga as redes deste computador. Escolha uma delas (ou uma parte dela).',
      );
    }
    if (cidr.hosts > DISCOVERY_MAX_HOSTS) throw invalid('Rede grande demais: use no máximo /16.');
    if (cidr.hosts > DISCOVERY_CONFIRM_HOSTS && req.confirmLarge !== true) {
      throw new AppError('VALIDATION_FAILED', {}, [
        {
          path: 'confirmLarge',
          message: `Esta rede tem ${cidr.hosts} endereços e a varredura pode demorar. Confirme para continuar.`,
        },
      ]);
    }
    this.state = {
      state: 'running',
      cidr: formatCidr(cidr),
      startedAt: this.d.clock.now(),
      finishedAt: null,
      probed: 0,
      total: cidr.hosts,
      error: null,
      found: [],
    };
    this.d.audit.record({
      actor,
      action: 'discovery.scan',
      target: `network:${formatCidr(cidr)}`,
      details: { hosts: cidr.hosts },
    });
    void this.run(cidr).catch((e: unknown) => {
      this.d.logger.error({ err: e }, 'discovery failed');
      this.state = {
        ...this.state,
        state: 'failed',
        finishedAt: this.d.clock.now(),
        error: 'A descoberta falhou. Veja os logs e tente de novo.',
      };
    });
    return this.status();
  }

  private async run(cidr: Cidr): Promise<void> {
    const opts = {
      icmpTimeoutMs: this.d.settings.get('monitor.icmpTimeoutMs'),
      tcpPorts: this.d.settings.get('monitor.tcpPorts'),
      tcpTimeoutMs: this.d.settings.get('monitor.tcpTimeoutMs'),
    };
    const latency = new Map<string, number | null>();
    let batch: string[] = [];
    const flush = async () => {
      const results = await this.d.prober.probe(batch, opts);
      for (const [ip, r] of results) if (r.alive) latency.set(ip, r.latencyMs);
      this.state.probed += batch.length;
      batch = [];
    };
    for (const ip of hostsOf(cidr)) {
      batch.push(ip);
      if (batch.length >= BATCH) await flush();
    }
    if (batch.length > 0) await flush();

    const now = this.d.clock.now();
    const table = this.d.oui();
    // M9-F1: routers are not machines to wake; leave the default gateways out.
    const gateways = new Set(
      (await this.d.interfaces.list()).flatMap((i) => (i.gateway ? [i.gateway] : [])),
    );
    const entries = (await this.d.neighbors.read()).filter(
      (n) => contains(cidr, n.ip) && !gateways.has(n.ip),
    );
    const names = await this.reverseNames(entries.map((n) => n.ip));
    const found: DiscoveredDevice[] = entries.map((n) => {
      const seen = this.seen.get(n.mac) ?? { first: now, last: now };
      seen.last = now;
      this.seen.set(n.mac, seen);
      return {
        ip: n.ip,
        mac: n.mac,
        vendor: vendorOf(table, n.mac),
        hostname: names.get(n.ip) ?? null,
        latencyMs: latency.get(n.ip) ?? null,
        firstSeenAt: seen.first,
        lastSeenAt: seen.last,
        registered: this.d.findByMac(n.mac) ?? null,
        locallyAdministered: isLocallyAdministered(n.mac),
      };
    });
    this.state = { ...this.state, state: 'done', finishedAt: this.d.clock.now(), found };
  }

  /** Reverse DNS (which on Windows also covers NetBIOS/LLMNR names); failures leave no name. */
  private async reverseNames(ips: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const reverse = this.d.dns.reverse?.bind(this.d.dns);
    if (!reverse) return names;
    let next = 0;
    const worker = async () => {
      while (next < ips.length) {
        const ip = ips[next++]!;
        const name = (await reverse(ip).catch(() => []))[0];
        if (name) names.set(ip, name.split('.')[0]!.toUpperCase());
      }
    };
    await Promise.all(Array.from({ length: Math.min(DNS_CONCURRENCY, ips.length) }, worker));
    return names;
  }

  /** Bulk add (FR-101): machines registered meanwhile are skipped, never duplicated (AC-101-03). */
  add(
    req: {
      roomId: number | null;
      devices: { mac: string; ip: string; name: string; hostname?: string | null }[];
    },
    actor: Actor,
  ): DiscoveryAddResult {
    return this.d.transaction(() => {
      const skipped: string[] = [];
      let added = 0;
      for (const d of req.devices) {
        if (this.d.findByMac(d.mac)) {
          skipped.push(d.mac);
          continue;
        }
        this.d.createDevice(
          { name: d.name, mac: d.mac, ip: d.ip, hostname: d.hostname || null, roomId: req.roomId },
          actor,
        );
        added++;
      }
      this.d.audit.record({
        actor,
        action: 'discovery.add',
        // M9-F2: audit targets name the room, like every other entry ("room:Lab 3").
        target:
          req.roomId === null
            ? 'room:Sem sala'
            : `room:${this.d.roomName(req.roomId) ?? req.roomId}`,
        details: { added, skipped: skipped.length },
      });
      // Refresh "já cadastrado" on the current results.
      this.state.found = this.state.found.map((f) => ({
        ...f,
        registered: this.d.findByMac(f.mac) ?? null,
      }));
      return { added, skipped };
    });
  }
}
