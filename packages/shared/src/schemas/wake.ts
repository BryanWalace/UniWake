/** Wake requests (FR-003.3, spec §4 SR-01). Clients send target descriptors, never MAC lists. */
import { z } from 'zod';
import { idSchema, LIMITS } from './common';

const ids = z.array(idSchema).max(LIMITS.compactListMax);

export const wakeTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('devices'), deviceIds: ids.min(1) }),
  z.object({
    type: z.literal('rooms'),
    roomIds: ids,
    /** "Sem sala" is only included explicitly (SR-02). */
    includeNoRoom: z.boolean().default(false),
  }),
  z.object({ type: z.literal('tags'), tagIds: ids.min(1) }),
  z.object({ type: z.literal('all') }),
]);
export type WakeTarget = z.output<typeof wakeTargetSchema>;

export const staggerOverrideSchema = z.object({
  batchSize: z.number().int().min(1).max(500),
  batchDelaySeconds: z.number().int().min(0).max(600),
});

export const wakeRequestSchema = z.object({
  target: wakeTargetSchema,
  onlyOffline: z.boolean().default(false),
  /** Required when the action is large (SR-10): must equal the resolved device count. */
  confirm: z.object({ count: z.number().int().min(0) }).optional(),
  stagger: staggerOverrideSchema.optional(),
});
export type WakeRequest = z.input<typeof wakeRequestSchema>;
export type WakeRequestParams = z.output<typeof wakeRequestSchema>;

export type ExclusionReason = 'disabled' | 'online' | 'in_active_job';

export interface WakeExclusion {
  deviceId: number;
  name: string;
  reason: ExclusionReason;
  jobId?: number;
}

export interface WakePreview {
  count: number;
  rooms: { roomId: number | null; name: string; count: number }[];
  excluded: WakeExclusion[];
  needsConfirmation: boolean;
}

export const JOB_STATES = [
  'pendente',
  'enviando',
  'verificando',
  'concluido',
  'interrompido',
  'falhou',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const DEVICE_RESULTS = [
  'aguardando',
  'acordou',
  'ja_estava_ligado',
  'nao_respondeu',
  'falha_no_envio',
  'nao_verificado',
] as const;
export type DeviceResult = (typeof DEVICE_RESULTS)[number];

/** pt-BR labels for job states and device results (spec FR-003.5). */
export const JOB_STATE_LABEL: Record<JobState, string> = {
  pendente: 'Pendente',
  enviando: 'Enviando',
  verificando: 'Verificando',
  concluido: 'Concluído',
  interrompido: 'Interrompido',
  falhou: 'Falhou',
};
export const DEVICE_RESULT_LABEL: Record<DeviceResult, string> = {
  aguardando: 'Aguardando',
  acordou: 'Acordou',
  ja_estava_ligado: 'Já estava ligado',
  nao_respondeu: 'Não respondeu',
  falha_no_envio: 'Falha no envio',
  nao_verificado: 'Sem IP para verificar',
};

export interface JobSummary {
  total: number;
  woke: number;
  alreadyOn: number;
  noResponse: number;
  sendFailed: number;
  unverified: number;
  waiting: number;
  excluded: number;
}

export interface WakeJob {
  id: number;
  source: 'manual' | 'schedule' | 'test';
  requestedBy: string | null;
  targetLabel: string;
  onlyOffline: boolean;
  dryRun: boolean;
  state: JobState;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  verifyUntil: number | null;
  summary: JobSummary;
}

export interface WakeJobDevice {
  deviceId: number;
  name: string;
  mac: string;
  roomId: number | null;
  result: DeviceResult;
  sentAt: number | null;
  wokeAt: number | null;
}
