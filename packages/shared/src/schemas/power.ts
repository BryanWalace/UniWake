/** Manual shutdown and restart from the panel (FR-305, plan §15.4). */
import { z } from 'zod';
import type { PowerPolicy } from '../agent/checkin';
import { idSchema, LIMITS } from './common';
import { wakeTargetSchema } from './wake';

/**
 * Warning option (owner Q-7): "Aviso: 1 min" without postpone (default) or "5 min com adiamento"
 * (the schedules' defaults from the settings).
 */
export const POWER_WARNING_OPTIONS = ['short', 'standard'] as const;

export const powerRequestSchema = z.object({
  action: z.enum(['shutdown', 'restart']),
  target: wakeTargetSchema,
  warning: z.enum(POWER_WARNING_OPTIONS).default('short'),
  /** SR-10: must equal the number of machines that will receive the order. */
  confirm: z.object({ count: z.number().int().min(0) }).optional(),
  /** FR-305: also shut down machines flagged "Nunca desligar por agendamento". */
  confirmProtected: z.boolean().default(false),
  /**
   * v1.6 (FR-601.1): preview with a "Desligar" schedule's rules — machines flagged "Nunca desligar
   * por agendamento" or carrying one of these tags are listed in `excluded`, not counted. Preview only.
   */
  schedule: z
    .object({ excludeTagIds: z.array(idSchema).max(LIMITS.compactListMax).default([]) })
    .optional(),
});
export type PowerRequest = z.input<typeof powerRequestSchema>;
export type PowerRequestParams = z.output<typeof powerRequestSchema>;

export interface PowerDeviceRef {
  deviceId: number;
  name: string;
}

export interface PowerPreview {
  action: 'shutdown' | 'restart';
  /** Machines that will receive the order. */
  count: number;
  rooms: { roomId: number | null; name: string; count: number }[];
  needsConfirmation: boolean;
  /** Prepared with v1.2 (or never with the agent): excluded, need the new preparation. */
  needsPreparation: PowerDeviceRef[];
  /** "Desligamento remoto revogado": excluded. */
  revoked: PowerDeviceRef[];
  /** "Desligamento remoto perdido" (online, not checking in): excluded (AC-309-01). */
  lost: PowerDeviceRef[];
  /** Ready machines whose last check-in said a user was logged on (Q-7). */
  withUser: number;
  /** Ready machines the monitor sees offline: their order waits until they check in (≤ 2 h). */
  offline: number;
  /** Flagged "Nunca desligar por agendamento": included only with an extra confirmation. */
  protected: PowerDeviceRef[];
  /** v1.6 (FR-501.5): targeted machines that are the PC running this UniWake. */
  self: PowerDeviceRef[];
  /** v1.6 (FR-601.1): with `schedule`, the ready machines the schedule skips and why. */
  excluded: (PowerDeviceRef & { reason: ExcludedReason })[];
  policy: PowerPolicy;
}

export const EXCLUDED_REASON_LABEL = {
  never_flag: 'Nunca desligar por agendamento',
  excluded_tag: 'etiqueta excluída neste agendamento',
} as const;
export type ExcludedReason = keyof typeof EXCLUDED_REASON_LABEL;

/**
 * Per-machine state of a manual job (pt-BR labels in the panel):
 * pending (enviada), received (recebida), confirming (executou; aguardando confirmar pela rede),
 * done (desligou / reiniciou), not_confirmed (não confirmou), cancelled, expired, failed.
 */
export const POWER_DEVICE_STATES = [
  'pending',
  'received',
  'confirming',
  'done',
  'not_confirmed',
  'cancelled',
  'expired',
  'failed',
] as const;
export type PowerDeviceState = (typeof POWER_DEVICE_STATES)[number];

export interface PowerJobDevice extends PowerDeviceRef {
  state: PowerDeviceState;
  postpones: number;
  detail: string | null;
}

/** FR-309 readiness (pt-BR labels in `AGENT_READINESS_LABELS`). */
export const AGENT_READINESS = ['ready', 'needs_preparation', 'revoked', 'lost'] as const;
export type AgentReadinessState = (typeof AGENT_READINESS)[number];
export const AGENT_READINESS_LABELS: Record<AgentReadinessState, string> = {
  ready: 'Pronta para desligar',
  needs_preparation: 'Precisa do novo preparo',
  revoked: 'Desligamento remoto revogado',
  lost: 'Desligamento remoto perdido: provável congelamento ou tarefa removida',
};

/** What the panel shows about a machine's agent (FR-309, FR-308.1, owner Q-3). */
export interface DeviceAgentInfo {
  deviceId: number;
  readiness: AgentReadinessState;
  agentVersion: string | null;
  lastCheckin: number | null;
  freezeProduct: string | null;
  freezeState: string | null;
  persistentArea: boolean;
  /** AC sleep timeout read by the agent: 0 = never, null = unknown. */
  sleepAfterMinutes: number | null;
  wakeTimers: string | null;
  /** Q-6: only whether someone was logged on and how many sessions. */
  userLoggedOn: boolean | null;
  sessions: number | null;
  clockOffsetMs: number | null;
  tokenRotatedAt: number | null;
}

export interface PowerJob {
  id: number;
  action: 'shutdown' | 'restart';
  label: string;
  createdAt: number;
  createdBy: string | null;
  policy: PowerPolicy;
  expiresAt: number;
  counts: Record<PowerDeviceState, number>;
  devices: PowerJobDevice[];
}

/** One machine's result for one scheduled shutdown (FR-307; pt-BR labels in the panel). */
export const SHUTDOWN_RESULTS = [
  'done',
  'was_off',
  'late_wake',
  'cancelled',
  'failed',
  'probably_done',
  'no_report',
  // v1.6 reconciliation (ADR-054): machines without a report yet.
  'off_no_report',
  'postponed_active',
  'still_on',
  'no_agent',
  'stale_agenda',
  'no_answer',
] as const;
export type ShutdownResult = (typeof SHUTDOWN_RESULTS)[number];

/** pt-BR labels of a machine's result for one scheduled shutdown (history, reconciliation). */
export const SHUTDOWN_RESULT_LABEL: Record<ShutdownResult, string> = {
  done: 'Desligou',
  probably_done: 'Provavelmente desligou (sem relatório)',
  off_no_report: 'Desligou (relatório ainda não chegou)',
  was_off: 'Já estava desligada',
  late_wake: 'Pulado (acordou atrasada)',
  cancelled: 'Cancelado',
  failed: 'Falhou',
  no_report: 'Sem relatório',
  postponed_active: 'Adiado — usuário ativo',
  still_on: 'Ainda ligado',
  no_agent: 'Sem agente (precisa do preparo)',
  stale_agenda: 'Agenda desatualizada (a última agenda entregue não tinha este horário)',
  no_answer: 'Sem resposta (não consultou o UniWake desde antes do aviso)',
};

/** FR-502.1: why a shutdown schedule does (not) reach a machine. */
export const SHUTDOWN_REASON_LABEL = {
  included: 'Inclui esta máquina',
  schedule_disabled: 'Agendamento desativado',
  device_disabled: 'Máquina desativada no cadastro',
  not_in_target:
    'O alvo do agendamento não inclui esta máquina (confira a sala, as etiquetas ou a lista de máquinas)',
  never_flag: 'Máquina marcada "Nunca desligar por agendamento"',
  excluded_tag: 'Uma etiqueta desta máquina está excluída no agendamento',
  no_occurrence: 'Nenhum horário nos próximos 14 dias (feriado, recesso ou pausa)',
} as const;
export type ShutdownReason = keyof typeof SHUTDOWN_REASON_LABEL;

/** FR-504.3 "Testar agendamento": a one-off scheduled shutdown of one machine in N minutes. */
export const SHUTDOWN_TEST_MINUTES = { min: 2, max: 60, default: 5 } as const;
export const shutdownTestRequestSchema = z.object({
  minutes: z.number().int().min(SHUTDOWN_TEST_MINUTES.min).max(SHUTDOWN_TEST_MINUTES.max),
});
export type ShutdownTestRequest = z.infer<typeof shutdownTestRequestSchema>;

export interface ShutdownTest {
  uuid: string;
  /** The planned shutdown instant. */
  at: number;
  warningMinutes: number;
  createdAt: number;
  /** When the hub sent the order (push path), null before T − aviso − 1 min. */
  pushedAt: number | null;
  reconciledAt: number | null;
  /** Null while it is still ahead (or in its warning); then as in the history. */
  result: ShutdownResult | null;
  path: 'agenda' | 'order' | null;
}

/** FR-504.1: the device page's "Desligamento remoto" diagnostics. */
export interface ShutdownDiagnostics {
  agenda: {
    /** What the hub last served this machine (its last check-in). */
    servedVersion: string | null;
    servedItems: number | null;
    servedAt: number | null;
    /** What it would serve now. */
    currentVersion: string | null;
    currentItems: number;
    nextShutdownAt: number | null;
  };
  schedules: { scheduleId: number; name: string; reason: ShutdownReason; nextAt: number | null }[];
  lastShutdown: {
    at: number;
    result: ShutdownResult;
    path: 'agenda' | 'order' | null;
    detail: string | null;
  } | null;
  /** FR-504.3: the latest "Testar agendamento" of this machine (last 24 h). */
  test: ShutdownTest | null;
}

export interface PowerOccurrenceDevice extends PowerDeviceRef {
  result: ShutdownResult;
  /** v1.6: which path ran it — the agenda or the hub's order ("ordem direta"); null if unknown. */
  path: 'agenda' | 'order' | null;
  postpones: number;
  wasAsleep: boolean;
  lateMinutes: number | null;
  nativeWarning: boolean;
  userLoggedOn: boolean | null;
}

/** One scheduled shutdown aggregated over the machines' reports (AC-307-01). */
export interface PowerOccurrence {
  occurrence: string;
  scheduleId: number | null;
  /** null when the schedule was deleted meanwhile. */
  scheduleName: string | null;
  plannedAt: number | null;
  counts: Record<PowerOccurrenceDevice['result'] | 'postponed', number>;
  maxPostpones: number;
  devices: PowerOccurrenceDevice[];
}

export interface PowerHistory {
  occurrences: PowerOccurrence[];
  jobs: PowerJob[];
}
