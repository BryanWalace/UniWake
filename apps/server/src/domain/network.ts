/**
 * Network interfaces and broadcast destinations (FR-003.2, plan §2.6). Pure.
 */

export interface NetInterface {
  /** Windows interface alias, e.g. "Ethernet". */
  name: string;
  /** IPv4 address of the interface. */
  address: string;
  prefixLength: number;
  netmask: string;
  mac: string;
  /** Default gateway reachable through this interface, if any. */
  gateway: string | null;
  internal: boolean;
}

export function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`invalid IPv4: ${ip}`);
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function prefixFromNetmask(netmask: string): number {
  const n = ipToInt(netmask);
  let bits = 0;
  for (let i = 31; i >= 0 && (n >>> i) & 1; i--) bits++;
  return bits;
}

/** Subnet-directed broadcast, e.g. 10.0.4.20/23 → 10.0.5.255. Null for /31 and /32. */
export function subnetBroadcast(address: string, prefixLength: number): string | null {
  if (prefixLength >= 31) return null;
  const hostBits = 32 - prefixLength;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << hostBits) >>> 0;
  return intToIp(((ipToInt(address) & mask) | (~mask >>> 0)) >>> 0);
}

export function sameSubnet(a: string, b: string, prefixLength: number): boolean {
  if (prefixLength === 0) return true;
  const mask = (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipToInt(a) & mask) >>> 0 === (ipToInt(b) & mask) >>> 0;
}

export const isApipa = (ip: string) => ip.startsWith('169.254.');
export const isLoopback = (ip: string) => ip.startsWith('127.');

/**
 * Interfaces used to send (FR-003.2). Configured addresses win; otherwise interfaces that are
 * not loopback, not APIPA and have a default gateway (excludes Hyper-V/VirtualBox/VPN adapters
 * that usually have none — phase-1 D1-04).
 */
export function selectInterfaces(
  all: readonly NetInterface[],
  configured: readonly string[],
): NetInterface[] {
  const usable = all.filter((i) => !i.internal && !isLoopback(i.address) && !isApipa(i.address));
  if (configured.length > 0) return usable.filter((i) => configured.includes(i.address));
  return usable.filter((i) => i.gateway !== null);
}

export const LIMITED_BROADCAST = '255.255.255.255';

export interface SendRoute {
  /** Local IPv4 the socket binds to, so the packet leaves through that interface. */
  sourceIp: string;
  destination: string;
}

/**
 * Where one device's magic packets go: from every selected interface to the limited broadcast
 * and that interface's subnet broadcast; plus the room's directed broadcast (routed subnets),
 * sent from interfaces with a gateway. De-duplicated.
 */
export function routesFor(
  interfaces: readonly NetInterface[],
  directedBroadcast: string | null,
): SendRoute[] {
  const seen = new Set<string>();
  const out: SendRoute[] = [];
  const add = (sourceIp: string, destination: string) => {
    const key = `${sourceIp}>${destination}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ sourceIp, destination });
  };
  for (const i of interfaces) {
    add(i.address, LIMITED_BROADCAST);
    const b = subnetBroadcast(i.address, i.prefixLength);
    if (b) add(i.address, b);
  }
  if (directedBroadcast) {
    const viaGateway = interfaces.filter((i) => i.gateway !== null);
    for (const i of viaGateway.length > 0 ? viaGateway : interfaces)
      add(i.address, directedBroadcast);
  }
  return out;
}
