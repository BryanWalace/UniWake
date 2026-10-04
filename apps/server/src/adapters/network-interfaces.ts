/**
 * IPv4 interfaces with their default gateways (FR-003.2, ADR-019). Read on every call, never
 * cached (constitution §2.6): DHCP can change the controller's address at any time.
 * Gateways: Windows `route.exe print -4` (numeric rows only, the headers are localized);
 * elsewhere /proc/net/route (development and CI).
 */
import { readFile } from 'node:fs/promises';
import { networkInterfaces as osNetworkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import { type NetInterface, prefixFromNetmask } from '../domain/network';
import type { NetworkInterfaces, ProcessRunner } from '../application/ports';

const IP = String.raw`(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})`;
const DEFAULT_ROUTE = new RegExp(
  String.raw`^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+${IP}\s+${IP}\s+(\d+)\s*$`,
);

/** Default routes from `route print -4`: interface IP → gateway (lowest metric wins). */
export function parseRoutePrint(output: string): Map<string, string> {
  const best = new Map<string, { gateway: string; metric: number }>();
  for (const line of output.split(/\r?\n/)) {
    const m = DEFAULT_ROUTE.exec(line);
    if (!m) continue;
    const [, gateway, iface, metric] = m as unknown as [string, string, string, string];
    const cur = best.get(iface);
    if (!cur || Number(metric) < cur.metric) best.set(iface, { gateway, metric: Number(metric) });
  }
  return new Map([...best].map(([iface, v]) => [iface, v.gateway]));
}

/** Default routes from Linux /proc/net/route: interface name → gateway. */
export function parseProcNetRoute(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8 || cols[1] !== '00000000') continue;
    const hex = cols[2] ?? '';
    if (!/^[0-9A-Fa-f]{8}$/.test(hex) || hex === '00000000') continue;
    const bytes = [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (!out.has(cols[0]!)) out.set(cols[0]!, bytes.join('.'));
  }
  return out;
}

export interface OsInterfacesOptions {
  platform?: NodeJS.Platform;
  list?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  readProcRoute?: () => Promise<string>;
  systemRoot?: string;
}

export class OsNetworkInterfaces implements NetworkInterfaces {
  private readonly platform: NodeJS.Platform;
  private readonly listOs: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  private readonly readProcRoute: () => Promise<string>;
  private readonly routeExe: string;

  constructor(
    private readonly runner: ProcessRunner,
    opts: OsInterfacesOptions = {},
  ) {
    this.platform = opts.platform ?? process.platform;
    this.listOs = opts.list ?? osNetworkInterfaces;
    this.readProcRoute = opts.readProcRoute ?? (() => readFile('/proc/net/route', 'utf8'));
    this.routeExe = join(
      opts.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'route.exe',
    );
  }

  async list(): Promise<NetInterface[]> {
    const gateways = await this.gateways();
    const out: NetInterface[] = [];
    for (const [name, entries] of Object.entries(this.listOs())) {
      for (const e of entries ?? []) {
        if (e.family !== 'IPv4') continue;
        const prefixLength = e.cidr ? Number(e.cidr.split('/')[1]) : prefixFromNetmask(e.netmask);
        out.push({
          name,
          address: e.address,
          prefixLength,
          netmask: e.netmask,
          mac: e.mac.toUpperCase(),
          gateway: gateways.byIp.get(e.address) ?? gateways.byName.get(name) ?? null,
          internal: e.internal,
        });
      }
    }
    return out;
  }

  private async gateways(): Promise<{ byIp: Map<string, string>; byName: Map<string, string> }> {
    try {
      if (this.platform === 'win32') {
        const r = await this.runner.run(this.routeExe, ['print', '-4'], { timeoutMs: 5000 });
        return { byIp: parseRoutePrint(r.stdout), byName: new Map() };
      }
      return { byIp: new Map(), byName: parseProcNetRoute(await this.readProcRoute()) };
    } catch {
      // Without gateway information the default selection finds no interface and the wake
      // fails loudly with NO_NETWORK_INTERFACE instead of guessing.
      return { byIp: new Map(), byName: new Map() };
    }
  }
}
