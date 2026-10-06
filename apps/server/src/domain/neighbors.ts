/**
 * The IPv4 neighbor (ARP) cache, as discovery reads it (FR-101). Two sources: `Get-NetNeighbor`
 * as JSON (preferred) and `arp -a` (fallback). Labels in `arp -a` are translated and arrive in the
 * console code page ("Endereço físico", "dinâmico"), so only addresses are read, never words
 * (AC-101-02). Broadcast, multicast and unresolved entries are dropped. Pure.
 */
import { parseMac } from '@uniwake/shared';

export interface Neighbor {
  ip: string;
  /** Canonical `AA:BB:CC:DD:EE:FF`. */
  mac: string;
  /** Address of the local interface the entry belongs to, when the source says it. */
  interfaceIp: string | null;
}

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Unicast host addresses only: no multicast (224/4), limited broadcast or 0.0.0.0. */
function usableIp(ip: string): boolean {
  if (!IPV4.test(ip)) return false;
  const first = Number(ip.split('.')[0]);
  return ip !== '255.255.255.255' && ip !== '0.0.0.0' && !(first >= 224 && first <= 239);
}

function neighbor(ip: string, rawMac: string, interfaceIp: string | null): Neighbor | null {
  if (!usableIp(ip)) return null;
  const mac = parseMac(rawMac);
  // parseMac refuses multicast (incl. FF-FF-FF-FF-FF-FF) and all-zero (unresolved) addresses.
  return mac.ok ? { ip, mac: mac.mac, interfaceIp } : null;
}

/** `arp -a` in any Windows language. */
export function parseArp(output: string): Neighbor[] {
  const out: Neighbor[] = [];
  let iface: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const header = /^\s*\S+:\s+(\d{1,3}(?:\.\d{1,3}){3})\s+---\s+0x[0-9a-f]+\s*$/i.exec(line);
    if (header) {
      iface = header[1]!;
      continue;
    }
    const m = /^\s+(\d{1,3}(?:\.\d{1,3}){3})\s+((?:[0-9a-f]{2}-){5}[0-9a-f]{2})\s+\S/i.exec(line);
    if (!m) continue;
    const n = neighbor(m[1]!, m[2]!, iface);
    if (n) out.push(n);
  }
  return out;
}

interface NetNeighborJson {
  IPAddress?: unknown;
  LinkLayerAddress?: unknown;
  /** MSFT_NetNeighbor State: 0 Unreachable, 1 Incomplete, 2 Probe, 3 Delay, 4 Stale, 5 Reachable, 6 Permanent (or its name). */
  State?: unknown;
}

const DEAD_STATES = new Set<unknown>([0, 1, 'Unreachable', 'Incomplete']);

/** `Get-NetNeighbor -AddressFamily IPv4 | ConvertTo-Json` (one object or an array). */
export function parseNetNeighborJson(json: string): Neighbor[] {
  const text = json.trim();
  if (text === '') return [];
  const parsed = JSON.parse(text) as NetNeighborJson | NetNeighborJson[];
  const out: Neighbor[] = [];
  for (const e of Array.isArray(parsed) ? parsed : [parsed]) {
    if (DEAD_STATES.has(e.State)) continue;
    if (typeof e.IPAddress !== 'string' || typeof e.LinkLayerAddress !== 'string') continue;
    const n = neighbor(e.IPAddress, e.LinkLayerAddress, null);
    if (n) out.push(n);
  }
  return out;
}

/** One entry per MAC (the last seen IP wins), in IP order. */
export function dedupeNeighbors(list: readonly Neighbor[]): Neighbor[] {
  const byMac = new Map<string, Neighbor>();
  for (const n of list) byMac.set(n.mac, n);
  const num = (ip: string) => ip.split('.').reduce((a, p) => a * 256 + Number(p), 0);
  return [...byMac.values()].sort((a, b) => num(a.ip) - num(b.ip));
}
