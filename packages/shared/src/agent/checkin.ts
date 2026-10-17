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

export const AGENT_SCRIPTS = ['uniwake-agent.ps1', 'uniwake-aviso.ps1'] as const;
const agentScriptName = z.enum(AGENT_SCRIPTS);

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
 * min late or after its next wake), `expired` (order too old), `error` (see detail),
 * `already_done` (v1.6: an order for a schedule occurrence the PC already ran from its agenda).
 */
export const REPORT_REASONS = ['was_off', 'late_wake', 'expired', 'error', 'already_done'] as const;

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

// ------------------------------------------------------------------ health (v1.6.0, ADR-059/060)
/** What a hub announces in its answers; an agent sends `health` only to hubs that list it. */
export const AGENT_FEATURES = ['health'] as const;
export type AgentFeature = (typeof AGENT_FEATURES)[number];

/**
 * Self-update outcomes (FR-603.2). `write_blocked`: Windows refused the write (error 225/226 =
 * antivirus); `removed_after_write`: the file was gone or changed right after writing.
 */
export const UPDATE_OUTCOMES = [
  'updated',
  'download_failed',
  'hash_mismatch',
  'write_blocked',
  'removed_after_write',
] as const;
export type UpdateOutcome = (typeof UPDATE_OUTCOMES)[number];

/**
 * The optional `health` part of a check-in (FR-603, FR-604). Unlike the rest of the contract its
 * objects drop (never store) fields they do not name instead of refusing them, so a newer agent
 * still checks in with an older hub that announced `health`. File names only, never paths.
 */
export const agentHealthSchema = z.object({
  /** Install steps applied on the machine (FR-603.3). */
  installLevel: z.number().int().min(0).max(1000),
  /** The last self-update attempt (null: none yet). */
  update: z
    .object({
      outcome: z.enum(UPDATE_OUTCOMES),
      file: agentScriptName,
      at: instant,
      /** Windows error code when known (225 = ERROR_VIRUS_INFECTED, 226 = ERROR_VIRUS_DELETED). */
      code: z.number().int().nullable(),
      detail: z.string().max(200).nullable(),
    })
    .nullable(),
  /** Notes of the repair task (FR-603.4), newest last. */
  repairs: z
    .array(
      z.object({
        at: instant,
        file: agentScriptName,
        reason: z.enum(['missing', 'changed']),
        outcome: z.enum(['restored', 'not_restored']),
      }),
    )
    .max(10),
  /** FR-604.1; null when unchanged since the last time it was sent. */
  antivirus: z
    .object({
      products: z
        .array(
          z.object({
            name: z.string().min(1).max(100),
            enabled: z.boolean().nullable(),
            upToDate: z.boolean().nullable(),
          }),
        )
        .max(6),
      detections: z
        .array(
          z.object({
            at: instant,
            threat: z.string().min(1).max(120),
            file: z.string().min(1).max(80),
            action: z.string().max(40).nullable(),
          }),
        )
        .max(10),
    })
    .nullable(),
  /** v1.6.0 (FR-605): sleep and hibernation facts; older 1.7 agents may omit it. */
  power: z
    .object({
      hibernateEnabled: z.boolean().nullable(),
      /** AC "hibernate after" in minutes; 0 = never; null = unknown. */
      hibernateAfterMinutes: z.number().int().min(0).max(100_000).nullable(),
      /** The last time the PC came back without restarting (suspended or hibernated). */
      lastResume: z
        .object({ from: instant, to: instant, kind: z.enum(['sleep', 'hibernate', 'unknown']) })
        .nullable(),
      /** FR-605.3: what the agent last did with "Impedir suspensão e hibernação". */
      preventSleep: z
        .object({
          state: z.enum(['applied', 'restored', 'failed']),
          at: instant,
          detail: z.string().max(200).nullable(),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
});
export type AgentHealth = z.infer<typeof agentHealthSchema>;

/** `POST /agent/v1/alert` from the repair task when it cannot restore the agent (FR-603.4). */
export const agentAlertSchema = z
  .object({
    protocol: z.literal(AGENT_PROTOCOL),
    kind: z.literal('agent_missing'),
    file: agentScriptName,
    at: instant,
  })
  .strict();
export type AgentAlert = z.infer<typeof agentAlertSchema>;

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
    /** v1.6.0: only to hubs whose answers list `health` in `features` (ADR-059). */
    health: agentHealthSchema.optional(),
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
    .extend({
      uuid,
      action: powerActionSchema.extract(['shutdown']),
      occurrence: uuid.optional(),
      plannedAt: instant.optional(),
    })
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
    /** v1.6.0 (ADR-059): what this hub accepts; older hubs omit it. */
    features: z.array(z.enum(AGENT_FEATURES)).max(8).optional(),
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
