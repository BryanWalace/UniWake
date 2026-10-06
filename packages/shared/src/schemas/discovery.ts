/**
 * Network discovery (FR-101): sweep a subnet of the UniWake computer, read the neighbor cache and
 * list what answered, so machines can be added in bulk. Discovery only sees the UniWake
 * computer's own subnets (broadcast-domain neighbors).
 */
import { z } from 'zod';
import { macSchema } from '../mac';
import { hostnameSchema, idSchema, ipv4Schema, LIMITS, nameSchema } from './common';

/** Above this many addresses (a /22) the panel asks for confirmation (AC-101-01). */
export const DISCOVERY_CONFIRM_HOSTS = 1022;
/** Never more than a /16. */
export const DISCOVERY_MAX_HOSTS = 65_534;

export const discoveryScanSchema = z.object({
  cidr: z
    .string()
    .trim()
    .regex(/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/, 'Use o formato 10.0.3.0/24.'),
  /** AC-101-01: required for more than DISCOVERY_CONFIRM_HOSTS addresses. */
  confirmLarge: z.boolean().optional(),
});
export type DiscoveryScanRequest = z.input<typeof discoveryScanSchema>;

export interface DiscoveredDevice {
  ip: string;
  mac: string;
  vendor: string | null;
  hostname: string | null;
  latencyMs: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
  /** AC-101-03: already in the inventory ("já cadastrado"); it cannot be added again. */
  registered: { id: number; name: string } | null;
  locallyAdministered: boolean;
}

export interface DiscoveryState {
  state: 'idle' | 'running' | 'done' | 'failed';
  cidr: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Addresses probed so far / in total. */
  probed: number;
  total: number;
  error: string | null;
  found: DiscoveredDevice[];
  /** Subnets of this computer, offered as choices. */
  subnets: { name: string; cidr: string; hosts: number }[];
}

export const discoveryAddSchema = z.object({
  roomId: idSchema.nullable(),
  devices: z
    .array(
      z.object({
        mac: macSchema,
        ip: ipv4Schema,
        name: nameSchema,
        hostname: z
          .union([z.literal(''), hostnameSchema])
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(LIMITS.compactListMax),
});
export type DiscoveryAddRequest = z.input<typeof discoveryAddSchema>;

export interface DiscoveryAddResult {
  added: number;
  /** MACs skipped because they were registered meanwhile (AC-101-03). */
  skipped: string[];
}
