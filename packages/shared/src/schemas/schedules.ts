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

/** A real calendar date `YYYY-MM-DD` (rejects 2026-02-30). */
export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, 'Data inválida.');

export const scheduleExceptionCreateSchema = z
  .object({
    /** Omitted or null = every schedule (holiday, recess). */
    scheduleId: z.number().int().positive().nullable().optional(),
    startDate: isoDateSchema,
    /** Defaults to the start date (one day). */
    endDate: isoDateSchema.optional(),
    description: z.string().trim().normalize('NFC').min(1, 'Informe uma descrição.').max(100),
  })
  .refine((e) => !e.endDate || e.endDate >= e.startDate, {
    message: 'A data final deve ser igual ou posterior à inicial.',
    path: ['endDate'],
  })
  .refine(
    (e) =>
      !e.endDate ||
      Date.parse(`${e.endDate}T00:00:00Z`) - Date.parse(`${e.startDate}T00:00:00Z`) <=
        366 * 86_400_000,
    { message: 'O período pode ter no máximo um ano.', path: ['endDate'] },
  );
export type ScheduleExceptionCreate = z.input<typeof scheduleExceptionCreateSchema>;

export interface ScheduleException {
  id: number;
  scheduleId: number | null;
  startDate: string;
  endDate: string;
  description: string;
}

/** FR-005.6: the reason is checked by the service so a blank one gets PAUSE_REASON_REQUIRED. */
export const schedulerPauseSchema = z.object({
  reason: z.string().max(200).optional(),
  /** Automatic resume, UTC epoch ms (the UI converts the operator's local date/time). */
  resumeAt: z.number().int().positive().nullable().optional(),
});
export type SchedulerPauseInput = z.input<typeof schedulerPauseSchema>;

export interface SchedulerPause {
  since: number;
  reason: string;
  resumeAt: number | null;
  /** Username of whoever paused, when known. */
  by: string | null;
}

export const RUN_STATUSES = [
  'executando',
  'executado',
  'atrasado',
  'pulado_feriado',
  'pulado_pausa',
  'perdido',
  'falhou',
] as const;
export type ScheduleRunStatus = (typeof RUN_STATUSES)[number];

/** pt-BR labels for the execution log (FR-005.7). */
export const RUN_STATUS_LABEL: Record<ScheduleRunStatus, string> = {
  executando: 'Executando',
  executado: 'Executado',
  atrasado: 'Atrasado',
  pulado_feriado: 'Pulado (feriado)',
  pulado_pausa: 'Pulado (pausa)',
  perdido: 'Perdido',
  falhou: 'Falhou',
};

export const scheduleRunsQuerySchema = z.object({
  scheduleId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ScheduleRunsQuery = z.output<typeof scheduleRunsQuerySchema>;

export interface ScheduleRun {
  id: number;
  scheduleId: number;
  scheduleName: string;
  plannedAt: number;
  /** When the scheduler handled it (late runs: after the planned time). */
  handledAt: number;
  status: ScheduleRunStatus;
  /** e.g. "atrasado (8 min)", the holiday name, "alvo vazio". */
  detail: string | null;
  jobId: number | null;
}
