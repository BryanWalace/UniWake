/**
 * Dashboard notices (FR-013 and later: enrollment moves, update failures). Notices stay pinned
 * until someone clicks "Ciente".
 */
import type { DeviceResult } from './wake';

export const NOTICE_TYPES = ['morning_result'] as const;

/** One scheduled run that needs attention in the "Resultado da manhã" card. */
export interface MorningRun {
  scheduleId: number;
  scheduleName: string;
  plannedAt: number;
  /** executado/atrasado with machines that did not wake, or a run that failed or was lost. */
  status: 'executado' | 'atrasado' | 'falhou' | 'perdido';
  detail: string | null;
  jobId: number | null;
  total: number;
  woke: number;
  /** Per room (null = "Sem sala"), the machines that did not wake. */
  notWoken: {
    roomId: number | null;
    roomName: string;
    devices: { id: number; name: string; result: DeviceResult }[];
  }[];
}

/** `data` of a `morning_result` notice: one per local day, runs appended as they finish. */
export interface MorningResult {
  day: string;
  runs: MorningRun[];
}
