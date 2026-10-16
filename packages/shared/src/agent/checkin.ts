/**
 * Agent wire contract, protocol 1 (spec FR-302..304, ADR-043/045). Objects are strict: a field the
 * contract does not name is refused, so nothing extra (e.g. a user name, LGPD Q-6) can be stored.
 * Times are UTC epoch milliseconds.
 */
import { z } from 'zod';
import {
  AGENDA_MAX_ITEMS,
  AGENT_PROTOCOL,
  CHECKIN_MAX_REPORTS,
  POSTPONE_MAX_LIMIT,
  POSTPONE_MINUTES_MAX,
  POSTPONE_MINUTES_MIN,
  WARNING_MINUTES_MAX,
} from './constants';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const b64url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);
const instant = z.number().int().min(0);
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** 16 random bytes from the PC, base64url (22 chars); answers are signed over it (ADR-044). */
export const agentNonceSchema = b64url(16, 64);

export const FREEZE_PRODUCTS = [
  'deep_freeze',
  'uwf',
  'reboot_restore_rx',
  'shadow_defender',
] as const;
export const freezeProductSchema = z.enum(FREEZE_PRODUCTS);
export type FreezeProduct = z.infer<typeof freezeProductSchema>;

/** FR-308.1 states (pt-BR labels in `FREEZE_STATE_LABELS`). */
export const FREEZE_STATES = ['none', 'frozen', 'thawed', 'present_unknown', 'unverified'] as const;
export const freezeStateSchema = z.enum(FREEZE_STATES);
export type FreezeState = z.infer<typeof freezeStateSchema>;
export const FREEZE_STATE_LABELS: Record<FreezeState, string> = {
  none: 'não detectado',
  frozen: 'detectado (congelada)',
  thawed: 'detectado (descongelada)',
  present_unknown: 'detectado (estado não verificado)',
  unverified: 'não verificado',
};

export const WAKE_TIMER_STATES = ['enabled', 'disabled', 'important_only', 'unknown'] as const;
export const wakeTimersSchema = z.enum(WAKE_TIMER_STATES);

export const powerActionSchema = z.enum(['shutdown', 'restart']);
export type PowerAction = z.infer<typeof powerActionSchema>;

/** Warning and postpone policy of one order or agenda item (FR-304). */
export const powerPolicySchema = z.object({
  warningMinutes: z.number().int().min(0).max(WARNING_MINUTES_MAX),
  allowPostpone: z.boolean(),
  postponeMax: z.number().int().min(0).max(POSTPONE_MAX_LIMIT),
  postponeMinutes: z.number().int().min(POSTPONE_MINUTES_MIN).max(POSTPONE_MINUTES_MAX),
});
export type PowerPolicy = z.infer<typeof powerPolicySchema>;

// ------------------------------------------------------------------ reports (FR-304.5)
export const REPORT_OUTCOMES = ['done', 'cancelled', 'skipped', 'failed'] as const;
/**
 * Why an item did not run as planned: `was_off` (booted after T), `late_wake` (woke more than 60
 * min late or after its next wake), `expired` (order too old), `error` (see detail).
 */
export const REPORT_REASONS = ['was_off', 'late_wake', 'expired', 'error'] as const;

export const agentReportSchema = z
  .object({
    uuid,
    occurrence: uuid.nullable(),
    order: uuid.nullable(),
    action: powerActionSchema,
    outcome: z.enum(REPORT_OUTCOMES),
    reason: z.enum(REPORT_REASONS).nullable(),
    plannedAt: instant.nullable(),
    executedAt: instant.nullable(),
    postpones: z.number().int().min(0).max(POSTPONE_MAX_LIMIT),
    userLoggedOn: z.boolean().nullable(),
    sessions: z.number().int().min(0).max(64).nullable(),
    wasAsleep: z.boolean(),
    lateMinutes: z.number().int().min(0).max(100_000).nullable(),
    nativeWarning: z.boolean(),
    freezeState: freezeStateSchema,
    detail: z.string().max(500).nullable(),
  })
  .strict()
  // v1.6 (ADR-053): an order pushed for a schedule occurrence reports both ids (the occurrence for
  // the schedule's history, the order for the path); an agenda item has no order.
  .refine((r) => r.occurrence !== null || r.order !== null, {
    message: 'A report belongs to an agenda item or an order',
  });
export type AgentReport = z.infer<typeof agentReportSchema>;

// ------------------------------------------------------------------ check-in request
export const checkinRequestSchema = z
  .object({
    protocol: z.literal(AGENT_PROTOCOL),
    nonce: agentNonceSchema,
    agentVersion: z.string().min(1).max(32),
    bootTime: instant.nullable(),
    /** The PC's own clock when it sent the request (offset diagnostics, ADR-045). */
    clock: instant,
    freeze: z
      .object({
        product: freezeProductSchema.nullable(),
        state: freezeStateSchema,
        persistent: z.boolean(),
      })
      .strict(),
    power: z
      .object({
        /** AC sleep timeout read from the power plan; 0 = never; null = unknown (Q-3). */
        sleepAfterMinutes: z.number().int().min(0).max(100_000).nullable(),
        wakeTimers: wakeTimersSchema,
      })
      .strict(),
    /** Q-6: whether someone is logged on and how many sessions; never who. */
    session: z
      .object({
        loggedOn: z.boolean().nullable(),
        sessions: z.number().int().min(0).max(64),
      })
      .strict(),
    reports: z.array(agentReportSchema).max(CHECKIN_MAX_REPORTS),
    ackedOrders: z.array(uuid).max(CHECKIN_MAX_REPORTS),
  })
  .strict();
export type CheckinRequest = z.infer<typeof checkinRequestSchema>;

// ------------------------------------------------------------------ answer
export const agendaItemSchema = powerPolicySchema
  .extend({
    /** Deterministic occurrence UUID (ADR-031): the same on every team hub. */
    occurrence: uuid,
    /** Shutdown time T (the warning starts `warningMinutes` before it). */
    at: instant,
    action: z.literal('shutdown'),
  })
  .strict();
export type AgendaItem = z.infer<typeof agendaItemSchema>;

export const agendaSchema = z
  .object({
    /** Content hash: two hubs with the same data send the same version. */
    version: z.string().regex(/^[0-9a-f]{16,64}$/),
    window: z.object({ from: instant, to: instant }).strict(),
    items: z.array(agendaItemSchema).max(AGENDA_MAX_ITEMS),
    /** The PC's wake times inside the window (late-wake rule, ADR-045). */
    nextWakes: z.array(instant).max(AGENDA_MAX_ITEMS),
  })
  .strict()
  .refine((a) => a.window.from < a.window.to, { message: 'Empty window' })
  .refine((a) => a.items.every((i) => i.at >= a.window.from && i.at <= a.window.to), {
    message: 'Agenda items must lie inside the window',
  });
export type Agenda = z.infer<typeof agendaSchema>;

export const agentOrderSchema = z.discriminatedUnion('action', [
  // v1.6 (ADR-053): `occurrence` is the run id shared with the agenda item it may duplicate.
  powerPolicySchema
    .extend({ uuid, action: powerActionSchema.extract(['shutdown']), occurrence: uuid.optional() })
    .strict(),
  powerPolicySchema
    .extend({ uuid, action: powerActionSchema.extract(['restart']), occurrence: uuid.optional() })
    .strict(),
  z.object({ uuid, action: z.literal('cancel'), cancels: uuid }).strict(),
]);
export type AgentOrder = z.infer<typeof agentOrderSchema>;

export const publicJwkSchema = z.object({ n: b64url(256, 1024), e: b64url(1, 16) }).strict();

export const hubEntrySchema = z
  .object({
    instanceId: uuid,
    urls: z
      .array(z.string().regex(/^http:\/\/[0-9.]{7,15}:\d{1,5}$/))
      .min(1)
      .max(4),
    keyId: b64url(43, 43),
    publicKey: publicJwkSchema,
  })
  .strict();

export const AGENT_SCRIPTS = ['uniwake-agent.ps1', 'uniwake-aviso.ps1'] as const;
export const scriptRefSchema = z
  .object({ version: z.string().min(1).max(32), sha256: sha256Hex })
  .strict();

export const checkinAnswerSchema = z
  .object({
    protocol: z.literal(AGENT_PROTOCOL),
    serverTime: instant,
    orders: z.array(agentOrderSchema).max(CHECKIN_MAX_REPORTS),
    agenda: agendaSchema,
    message: z
      .object({ warning: z.string().min(1).max(300), postpone: z.string().min(1).max(300) })
      .strict(),
    hubs: z
      .object({ epoch: z.number().int().min(0), list: z.array(hubEntrySchema).max(16) })
      .strict(),
    scripts: z
      .object({ 'uniwake-agent.ps1': scriptRefSchema, 'uniwake-aviso.ps1': scriptRefSchema })
      .strict(),
    ackReports: z.array(uuid).max(CHECKIN_MAX_REPORTS),
    /** Rotation (ADR-043): the PC switches to it; the old token works until it does. */
    newToken: b64url(43, 43).nullable(),
  })
  .strict();
export type CheckinAnswer = z.infer<typeof checkinAnswerSchema>;

// ------------------------------------------------------------------ enrollment extension
/** Optional field of `POST /agent/enroll` from v1.3 scripts (older scripts omit it). */
export const enrollAgentRequestSchema = z
  .object({ protocol: z.literal(AGENT_PROTOCOL), nonce: agentNonceSchema })
  .strict();

export const enrollAgentAnswerSchema = z
  .object({
    token: b64url(43, 43),
    keyId: b64url(43, 43),
    hubKey: publicJwkSchema,
    scripts: checkinAnswerSchema.shape.scripts,
  })
  .strict();
export type EnrollAgentAnswer = z.infer<typeof enrollAgentAnswerSchema>;
