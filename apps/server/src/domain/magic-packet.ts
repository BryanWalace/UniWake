/** Wake-on-LAN magic packet (FR-003.1): 6 × 0xFF followed by 16 × the target MAC (102 bytes). */
import { macToBytes } from '@uniwake/shared';

export const MAGIC_PACKET_LENGTH = 102;

export function magicPacket(mac: string): Uint8Array {
  const macBytes = macToBytes(mac);
  const packet = new Uint8Array(MAGIC_PACKET_LENGTH);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) packet.set(macBytes, 6 + i * 6);
  return packet;
}

/** The MAC a magic packet targets (used by tests and the packet log). */
export function macOfPacket(packet: Uint8Array): string {
  return [...packet.slice(6, 12)]
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}
