/**
 * MAC address parsing and validation (FR-002.1, IMP-012).
 * Pure; used by server (domain, enrollment, CSV) and web (forms).
 */
import { z } from 'zod';

export type MacRejection = 'format' | 'multicast' | 'zero';

export type MacParseResult =
  { ok: true; mac: string; locallyAdministered: boolean } | { ok: false; reason: MacRejection };

const COLON = /^([0-9a-f]{2})(?::([0-9a-f]{2})){5}$/i;
const DASH = /^([0-9a-f]{2})(?:-([0-9a-f]{2})){5}$/i;
const DOTTED = /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i;
const PLAIN = /^[0-9a-f]{12}$/i;

/** Extracts the 12 hex digits if `input` uses one of the accepted formats, else null. */
function hexDigits(input: string): string | null {
  const s = input.trim();
  if (COLON.test(s) || DASH.test(s)) return s.replace(/[:-]/g, '');
  if (DOTTED.test(s)) return s.replace(/\./g, '');
  if (PLAIN.test(s)) return s;
  return null;
}

/**
 * Accepts `AA:BB:CC:DD:EE:FF`, `AA-BB-CC-DD-EE-FF`, `AABB.CCDD.EEFF` and `AABBCCDDEEFF` in any case,
 * trimmed. Rejects multicast (bit 0 of the first octet, which includes broadcast) and all-zero.
 * Returns the canonical uppercase colon form.
 */
export function parseMac(input: string): MacParseResult {
  const hex = hexDigits(input);
  if (hex === null) return { ok: false, reason: 'format' };
  const upper = hex.toUpperCase();
  const firstOctet = parseInt(upper.slice(0, 2), 16);
  if ((firstOctet & 0x01) === 0x01) return { ok: false, reason: 'multicast' };
  if (/^0{12}$/.test(upper)) return { ok: false, reason: 'zero' };
  const mac = upper.match(/.{2}/g)!.join(':');
  return { ok: true, mac, locallyAdministered: (firstOctet & 0x02) === 0x02 };
}

/** Bit 1 of the first octet: randomized / virtual MACs (Wi-Fi privacy, Hyper-V, VPN). */
export function isLocallyAdministered(mac: string): boolean {
  const r = parseMac(mac);
  return r.ok && r.locallyAdministered;
}

export function macToBytes(mac: string): Uint8Array {
  const r = parseMac(mac);
  if (!r.ok) throw new Error(`invalid MAC: ${mac}`);
  return Uint8Array.from(r.mac.split(':').map((h) => parseInt(h, 16)));
}

const REJECTION_MESSAGES: Record<MacRejection, string> = {
  format: 'MAC inválido. Use o formato AA:BB:CC:DD:EE:FF.',
  multicast: 'MAC de grupo (multicast/broadcast) não identifica uma placa de rede.',
  zero: 'MAC 00:00:00:00:00:00 não é válido.',
};

/** Zod schema: accepts any supported format, outputs the canonical form. */
export const macSchema = z.string().transform((value, ctx) => {
  const r = parseMac(value);
  if (!r.ok) {
    ctx.issues.push({ code: 'custom', message: REJECTION_MESSAGES[r.reason], input: value });
    return z.NEVER;
  }
  return r.mac;
});
