/** Name-based UUIDs (RFC 9562 version 5, SHA-1), for identities every installation derives alike. */
import { createHash } from 'node:crypto';

/** Namespace for UniWake's derived identities (a fixed random UUID; never change it). */
export const UNIWAKE_NAMESPACE = '6f1c2a8e-3b7d-4e59-9a40-58d2c71e0b13';

export function uuidV5(name: string, namespace: string = UNIWAKE_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The identity of one scheduled occurrence: the same on every installation (ADR-031 §2). */
export function scheduleRunUuid(scheduleUuid: string, plannedAt: number): string {
  return uuidV5(`schedule-run:${scheduleUuid}:${plannedAt}`);
}
