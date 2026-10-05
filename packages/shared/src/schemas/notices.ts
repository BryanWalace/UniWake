/**
 * Dashboard notices (FR-013 and later: enrollment moves, update failures). Notices stay pinned
 * until someone clicks "Ciente".
 */
import type { DeviceResult } from './wake';

export const NOTICE_TYPES = ['morning_result', 'enrollment_moves'] as const;

/** One machine moved to another room by self-enrollment (AC-007-07). */
export interface EnrollMove {
  deviceId: number;
  deviceName: string;
  from: string;
  to: string;
  at: number;
}

/** `data` of an `enrollment_moves` notice: moves of the last 24 h. */
export interface EnrollmentMoves {
  moves: EnrollMove[];
}

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
