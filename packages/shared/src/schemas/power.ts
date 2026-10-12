/** Manual shutdown and restart from the panel (FR-305, plan §15.4). */
import { z } from 'zod';
import type { PowerPolicy } from '../agent/checkin';
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
  /** Ready machines whose last check-in said a user was logged on (Q-7). */
  withUser: number;
  /** Ready machines the monitor sees offline: their order waits until they check in (≤ 2 h). */
  offline: number;
  /** Flagged "Nunca desligar por agendamento": included only with an extra confirmation. */
  protected: PowerDeviceRef[];
  policy: PowerPolicy;
}

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
