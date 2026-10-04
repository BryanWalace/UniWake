import { z } from 'zod';
import {
  colorSchema,
  LIMITS,
  nameSchema,
  notesSchema,
  optionalIpv4Schema,
  optionalText,
  requiredText,
} from './common';

/** Room code used by enrollment, e.g. `LAB3` (FR-008.1). Input is uppercased. */
export const roomCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9-]{2,16}$/, 'Código da sala: 2 a 16 caracteres (letras, números ou hífen).'),
  );

const staggerFields = {
  batchSize: z.number().int().min(1).max(500).nullable().optional(),
  batchDelaySeconds: z.number().int().min(0).max(600).nullable().optional(),
};

export const roomCreateSchema = z.object({
  name: nameSchema,
  code: roomCodeSchema.optional(),
  block: optionalText(LIMITS.block),
  floor: optionalText(LIMITS.floor),
  color: colorSchema.optional(),
  notes: notesSchema,
  directedBroadcast: optionalIpv4Schema,
  ...staggerFields,
});
export type RoomCreate = z.input<typeof roomCreateSchema>;

export const roomUpdateSchema = roomCreateSchema.partial().extend({ name: nameSchema.optional() });
export type RoomUpdate = z.input<typeof roomUpdateSchema>;

export interface Room {
  id: number;
  name: string;
  code: string;
  block: string | null;
  floor: string | null;
  color: string;
  notes: string | null;
  directedBroadcast: string | null;
  batchSize: number | null;
  batchDelaySeconds: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoomDeleteImpact {
  deviceCount: number;
  schedules: { id: number; name: string }[];
}

export const DEFAULT_ROOM_COLOR = '#2563eb';

export const tagNameSchema = requiredText(LIMITS.tagName);

export const tagCreateSchema = z.object({
  name: tagNameSchema,
  color: colorSchema.optional(),
});
export type TagCreate = z.input<typeof tagCreateSchema>;
export const tagUpdateSchema = tagCreateSchema.partial();
export type TagUpdate = z.input<typeof tagUpdateSchema>;

export interface Tag {
  id: number;
  name: string;
  color: string;
  deviceCount?: number;
}

export const DEFAULT_TAG_COLOR = '#64748b';
