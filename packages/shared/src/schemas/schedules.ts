/**
 * Schedules (FR-005.1, FR-005.8). Weekdays are a bitmask Mon=1 … Sun=64; times are local `HH:mm`
 * in an IANA zone; the target uses the same descriptor as a manual wake.
 */
import { z } from 'zod';
import { timeZoneSchema } from '../settings';
import { nameSchema } from './common';
import { staggerOverrideSchema, type WakeTarget, wakeTargetSchema } from './wake';

export const WEEKDAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;

export const timeLocalSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm (ex.: 06:50).');

export const weekdaysSchema = z
  .number()
  .int()
  .min(1, 'Escolha pelo menos um dia da semana.')
  .max(127, 'Dias da semana inválidos.');

export const scheduleCreateSchema = z.object({
  name: nameSchema,
  enabled: z.boolean().default(true),
  weekdays: weekdaysSchema,
  timeLocal: timeLocalSchema,
  /** Defaults to the `scheduler.timezone` setting. */
  timezone: timeZoneSchema.optional(),
  target: wakeTargetSchema,
  onlyOffline: z.boolean().default(false),
  stagger: staggerOverrideSchema.nullable().optional(),
  /** Large targets (SR-10) are confirmed once, when saved: must equal the resolved count. */
  confirm: z.object({ count: z.number().int().min(0) }).optional(),
});
export type ScheduleCreate = z.input<typeof scheduleCreateSchema>;

export const scheduleUpdateSchema = scheduleCreateSchema
  .omit({ enabled: true, onlyOffline: true })
  .partial()
  .extend({ enabled: z.boolean().optional(), onlyOffline: z.boolean().optional() });
export type ScheduleUpdate = z.input<typeof scheduleUpdateSchema>;

export interface Schedule {
  id: number;
  name: string;
  enabled: boolean;
  weekdays: number;
  timeLocal: string;
  timezone: string;
  target: WakeTarget;
  /** e.g. "sala Lab 3", "etiqueta professor", "todos". */
  targetLabel: string;
  onlyOffline: boolean;
  stagger: { batchSize: number; batchDelaySeconds: number } | null;
  confirmedCount: number | null;
  /** Machines the target resolves to now (disabled ones excluded). */
  targetCount: number;
  /** FR-005.8 "alvo vazio": the target resolves to nothing. */
  emptyTarget: boolean;
  /** Next run (UTC ms) after now, skipping exceptions; null when disabled. */
  nextRun: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NextRun {
  day: string;
  at: number;
}
