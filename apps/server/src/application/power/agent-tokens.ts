/**
 * Per-machine agent tokens (FR-302.2, ADR-043): 256 random bits, only the SHA-256 kept, one active
 * token plus at most one pending during rotation (the old one works until the machine uses the
 * new one), revocable per device. A machine frozen without a persistent area is never rotated: it
 * would lose the new token at the next restart and lock itself out.
 */
import { createHash, randomBytes } from 'node:crypto';
import { TOKEN_ROTATION_DAYS, type FreezeState } from '@uniwake/shared';
import type { Actor, AuditService } from '../audit/audit-service';
import type { Clock } from '../ports';

export interface DeviceAgentRow {
  deviceId: number;
  tokenHash: string | null;
  pendingTokenHash: string | null;
  issuedAt: number | null;
  rotatedAt: number | null;
  revokedAt: number | null;
  agentVersion: string | null;
  protocol: number | null;
  freezeProduct: string | null;
  freezeState: FreezeState | null;
  persistent: boolean;
  sleepAfterMinutes: number | null;
  wakeTimers: string | null;
  seenCoarseAt: number | null;
}

export interface DeviceAgentsRepo {
  byDevice(deviceId: number): DeviceAgentRow | undefined;
  /** The row whose active or pending token has this hash. */
  byTokenHash(hash: string): DeviceAgentRow | undefined;
  /** A fresh token for the device (enrollment): clears pending and revocation. */
  issue(deviceId: number, hash: string, now: number): void;
  setPending(deviceId: number, hash: string): void;
  promotePending(deviceId: number, now: number): void;
  revoke(deviceId: number, now: number): void;
}

export interface AgentTokensDeps {
  repo: DeviceAgentsRepo;
  audit: AuditService;
  clock: Clock;
  transaction: <T>(fn: () => T) => T;
}

const DAY = 86_400_000;
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export interface AgentIdentity {
  deviceId: number;
  row: DeviceAgentRow;
}

export class AgentTokensService {
  constructor(private readonly d: AgentTokensDeps) {}

  /** Issues the machine's token at enrollment; any previous token stops working. */
  issue(deviceId: number): string {
    const token = newToken();
    this.d.repo.issue(deviceId, tokenHash(token), this.d.clock.now());
    return token;
  }

  /**
   * The machine a token belongs to, or null (unknown, revoked). Using the pending token completes
   * the rotation: from then on only the new token works.
   */
  authenticate(token: string): AgentIdentity | null {
    const hash = tokenHash(token);
    const row = this.d.repo.byTokenHash(hash);
    if (!row || row.revokedAt !== null) return null;
    if (row.pendingTokenHash === hash) {
      this.d.repo.promotePending(row.deviceId, this.d.clock.now());
      return { deviceId: row.deviceId, row: this.d.repo.byDevice(row.deviceId)! };
    }
    return { deviceId: row.deviceId, row };
  }

  /** Whether the next answer should carry a new token (every 30 days; never while frozen). */
  rotationDue(row: DeviceAgentRow): boolean {
    if (row.rotatedAt === null || row.revokedAt !== null) return false;
    if (row.freezeState === 'frozen' && !row.persistent) return false;
    return this.d.clock.now() - row.rotatedAt >= TOKEN_ROTATION_DAYS * DAY;
  }

  /**
   * A new pending token. A previous pending one the machine never used (answer lost) is replaced:
   * only hashes are kept, so it could not be sent again anyway.
   */
  rotate(deviceId: number): string {
    const token = newToken();
    this.d.repo.setPending(deviceId, tokenHash(token));
    return token;
  }

  /** "Revogar desligamento remoto": only this machine's token stops working (FR-302.2). */
  revoke(deviceId: number, deviceName: string, actor: Actor): void {
    this.d.transaction(() => {
      this.d.repo.revoke(deviceId, this.d.clock.now());
      this.d.audit.record({ actor, action: 'agent.revoke', target: `device:${deviceName}` });
    });
  }
}
