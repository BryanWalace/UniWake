/**
 * Whether a machine can be shut down remotely (FR-309, FR-308.3, owner Q-5). Pure.
 * - needs_preparation: never prepared with v1.3 (no agent token);
 * - revoked: "Revogar desligamento remoto";
 * - lost: answers ping/TCP without interruption for 15 minutes since it last came online and has
 *   not checked in since then (freezing software or a removed task). Counting from the last
 *   offline→online transition keeps a PC that just booted from being flagged;
 * - ready: everything else.
 */
import { LOST_AFTER_MINUTES } from '@uniwake/shared';

export type AgentReadiness = 'ready' | 'needs_preparation' | 'revoked' | 'lost';

export interface ReadinessInput {
  hasToken: boolean;
  revoked: boolean;
  /** Latest check-in known to this hub (exact here, or the team's coarse time). */
  lastCheckin: number | null;
  /** Monitor (device_state). */
  online: boolean;
  onlineSince: number | null;
}

export function agentReadiness(i: ReadinessInput, now: number): AgentReadiness {
  if (!i.hasToken) return 'needs_preparation';
  if (i.revoked) return 'revoked';
  const steadyOnline =
    i.online && i.onlineSince !== null && now - i.onlineSince >= LOST_AFTER_MINUTES * 60_000;
  if (steadyOnline && (i.lastCheckin === null || i.lastCheckin < i.onlineSince!)) return 'lost';
  return 'ready';
}
