/** IPv4 CIDR helpers for discovery (FR-101). Pure. */
import { intToIp, ipToInt } from './network';

export interface Cidr {
  /** Network address. */
  network: number;
  prefix: number;
  /** Usable host addresses (network and broadcast excluded; /31 and /32 kept as is). */
  hosts: number;
}

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function parseCidr(text: string): Cidr | null {
  const [ip, p] = text.trim().split('/');
  const prefix = Number(p);
  if (!ip || !IPV4.test(ip) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipToInt(ip) & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  return { network, prefix, hosts: prefix >= 31 ? size : size - 2 };
}

export const formatCidr = (c: Pick<Cidr, 'network' | 'prefix'>) =>
  `${intToIp(c.network)}/${c.prefix}`;

/** The subnet an interface address belongs to. */
export function cidrOf(address: string, prefix: number): string {
  return formatCidr(parseCidr(`${address}/${prefix}`)!);
}

export function contains(c: Cidr, ip: string): boolean {
  if (!IPV4.test(ip)) return false;
  const mask = c.prefix === 0 ? 0 : (0xffffffff << (32 - c.prefix)) >>> 0;
  return (ipToInt(ip) & mask) >>> 0 === c.network;
}

/** Is `inner` entirely inside `outer`? */
export function within(inner: Cidr, outer: Cidr): boolean {
  return inner.prefix >= outer.prefix && contains(outer, intToIp(inner.network));
}

/** Host addresses in order. */
export function* hostsOf(c: Cidr): Generator<string> {
  const size = 2 ** (32 - c.prefix);
  const [from, to] = c.prefix >= 31 ? [0, size - 1] : [1, size - 2];
  for (let i = from; i <= to; i++) yield intToIp((c.network + i) >>> 0);
}
