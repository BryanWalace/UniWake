import { z } from 'zod';
import { macSchema } from '../mac';
import {
  idSchema,
  LIMITS,
  nameSchema,
  notesSchema,
  optionalHostnameSchema,
  optionalIpv4Schema,
} from './common';

export const DEVICE_STATUSES = ['online', 'offline', 'desconhecido'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const deviceCreateSchema = z.object({
  name: nameSchema,
  mac: macSchema,
  ip: optionalIpv4Schema,
  hostname: optionalHostnameSchema,
  roomId: idSchema.nullable().optional(),
  tagIds: z.array(idSchema).max(50).optional(),
  notes: notesSchema,
  enabled: z.boolean().optional(),
});
export type DeviceCreate = z.input<typeof deviceCreateSchema>;

export const deviceUpdateSchema = deviceCreateSchema.partial();
export type DeviceUpdate = z.input<typeof deviceUpdateSchema>;

export const deviceListQuerySchema = z.object({
  roomId: z.union([z.literal('none'), z.coerce.number().int().positive()]).optional(),
  tagId: z.coerce.number().int().positive().optional(),
  status: z.enum(DEVICE_STATUSES).optional(),
  q: z.string().trim().max(LIMITS.hostname).optional(),
  all: z
    .enum(['1', 'true'])
    .transform(() => true)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(50),
});
export type DeviceListQuery = z.input<typeof deviceListQuerySchema>;

export const BULK_ACTIONS = [
  'move',
  'addTags',
  'removeTags',
  'enable',
  'disable',
  'delete',
] as const;

export const deviceBulkSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('move'),
    deviceIds: z.array(idSchema).min(1).max(LIMITS.compactListMax),
    roomId: idSchema.nullable(),
  }),
  z.object({
    action: z.enum(['addTags', 'removeTags']),
    deviceIds: z.array(idSchema).min(1).max(LIMITS.compactListMax),
    tagIds: z.array(idSchema).min(1).max(50),
  }),
  z.object({
    action: z.enum(['enable', 'disable', 'delete']),
    deviceIds: z.array(idSchema).min(1).max(LIMITS.compactListMax),
  }),
]);
export type DeviceBulk = z.input<typeof deviceBulkSchema>;

export interface DeviceState {
  status: DeviceStatus;
  latencyMs: number | null;
  lastSeenAt: number | null;
  onlineSince: number | null;
  everOnline: boolean;
}

export interface Device extends DeviceState {
  id: number;
  name: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  roomId: number | null;
  tagIds: number[];
  notes: string | null;
  enabled: boolean;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  os: string | null;
  otherMacs: string[];
  preparedAt: number | null;
  enrolledAt: number | null;
  createdAt: number;
  updatedAt: number;
  flags: {
    macLocallyAdministered: boolean;
    neverResponded: boolean;
  };
}

/** Compact row for the dashboard list (`GET /api/devices?all=1`). */
export interface DeviceCompact {
  id: number;
  name: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  roomId: number | null;
  tagIds: number[];
  enabled: boolean;
  status: DeviceStatus;
  latencyMs: number | null;
  lastSeenAt: number | null;
}

/** Save responses carry non-blocking warnings (AC-002-04, AC-002-06). */
export interface DeviceSaveResult {
  device: Device;
  warnings: ('mac_locally_administered' | 'duplicate_name')[];
}
