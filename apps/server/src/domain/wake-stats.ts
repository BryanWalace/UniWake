/**
 * Wake history statistics for diagnostics (FR-010). Pure: input is the device's verified wake
 * results, newest first.
 */
import type { WakeStats } from '@uniwake/shared';

export type VerifiedResult = { result: 'acordou' | 'nao_respondeu'; at: number };

/** "Parou de acordar": this many "não respondeu" in a row after at least one "acordou". */
export const STOPPED_WAKING_AFTER = 3;
export const STATS_WINDOW = 30;

export function wakeStats(newestFirst: readonly VerifiedResult[]): WakeStats {
  const recent = newestFirst.slice(0, STATS_WINDOW);
  const successes = recent.filter((r) => r.result === 'acordou').length;
  let consecutiveFailures = 0;
  while (recent[consecutiveFailures]?.result === 'nao_respondeu') consecutiveFailures++;
  const lastSuccess = newestFirst.find((r) => r.result === 'acordou');
  return {
    attempts: recent.length,
    successes,
    successRate: recent.length > 0 ? successes / recent.length : null,
    lastSuccessAt: lastSuccess?.at ?? null,
    consecutiveFailures,
    stoppedWaking: consecutiveFailures >= STOPPED_WAKING_AFTER && lastSuccess !== undefined,
  };
}
