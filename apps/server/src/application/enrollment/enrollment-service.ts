/**
 * Enrollment tokens and the "Preparar máquinas" command (FR-007.3, ADR-011, ADR-013).
 * A token is shown once; only its SHA-256 is stored (AC-007-09). The command downloads the script
 * from the agent listener and checks it against the SHA-256 of the exact bytes that listener
 * serves (AC-007-13) before running it.
 */
import { createHash, randomBytes } from 'node:crypto';
import type {
  CreatedEnrollmentToken,
  EnrollmentAddresses,
  EnrollmentCommand,
  EnrollmentToken,
  EnrollmentTokenState,
} from '@uniwake/shared';
import { isApipa, isLoopback } from '../../domain/network';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock, NetworkInterfaces } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export interface EnrollmentTokenRow {
  id: number;
  tokenHash: string;
  roomId: number;
  createdBy: number | null;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revokedAt: number | null;
}

/** A token joined with its room and creator for display. */
export interface EnrollmentTokenView extends EnrollmentTokenRow {
  roomName: string;
  roomCode: string;
  createdByName: string | null;
}

export interface EnrollmentRepo {
  insertToken(t: Omit<EnrollmentTokenRow, 'id' | 'uses' | 'revokedAt'>): number;
  getToken(id: number): EnrollmentTokenView | undefined;
  findByHash(hash: string): EnrollmentTokenView | undefined;
  /** Tokens created since `since`, plus any still usable, newest first. */
  listTokens(since: number, now: number, limit: number): EnrollmentTokenView[];
  revoke(id: number, at: number): void;
}

/** The prepare script as served by the agent listener; null when the file is missing. */
export interface PrepareScript {
  bytes(): Buffer | null;
}

export interface EnrollmentDeps {
  repo: EnrollmentRepo;
  rooms: { get(id: number): { id: number; name: string; code: string } | undefined };
  interfaces: NetworkInterfaces;
  script: PrepareScript;
  settings: SettingsService;
  audit: AuditService;
  clock: Clock;
  transaction: <T>(fn: () => T) => T;
  agentPort: number;
}

const HOUR = 3_600_000;
/** How long ended tokens stay in the list. */
const LIST_DAYS = 30;

export const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

export function tokenState(t: EnrollmentTokenRow, now: number): EnrollmentTokenState {
  if (t.revokedAt !== null) return 'revogado';
  if (now >= t.expiresAt) return 'expirado';
  if (t.uses >= t.maxUses) return 'esgotado';
  return 'ativo';
}

/** Error for a token that cannot be used (AC-007-08). */
export function tokenError(state: EnrollmentTokenState): AppError | null {
  switch (state) {
    case 'revogado':
      return new AppError('ENROLL_TOKEN_REVOKED');
    case 'expirado':
      return new AppError('ENROLL_TOKEN_EXPIRED');
    case 'esgotado':
      return new AppError('ENROLL_TOKEN_EXHAUSTED');
    default:
      return null;
  }
}

/**
 * The one-liner for an elevated Windows PowerShell 5.1 (FR-007.3). It runs in its own script
 * block so `Stop` does not leak into the technician's session: a failed download stops it with
 * PowerShell's own error instead of reaching the hash check. Every value is from a closed
 * character set (IPv4, room code, base64url, hex), so single quotes need no escaping.
 */
export function buildCommand(p: {
  scriptUrl: string;
  hubUrl: string;
  sha256: string;
  roomCode: string;
  token: string;
}): string {
  for (const v of Object.values(p)) {
    if (!/^[A-Za-z0-9:/._-]+$/.test(v)) throw new Error(`unsafe value in command: ${v}`);
  }
  const hash = p.sha256.toUpperCase();
  return (
    `& { $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; ` +
    `$f=Join-Path $env:TEMP 'uniwake-prepare-target.ps1'; ` +
    `Invoke-WebRequest -UseBasicParsing -Uri '${p.scriptUrl}' -OutFile $f; ` +
    `if ((Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash -ne '${hash}') ` +
    `{ Remove-Item -LiteralPath $f; Write-Host 'Arquivo alterado — não execute' -ForegroundColor Red } ` +
    `else { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $f ` +
    `-HubUrl '${p.hubUrl}' -RoomCode '${p.roomCode}' -Token '${p.token}' } }`
  );
}

export class EnrollmentService {
  private hashed: { bytes: Buffer; sha256: string } | null = null;

  constructor(private readonly d: EnrollmentDeps) {}

  private view(t: EnrollmentTokenView, now: number): EnrollmentToken {
    return {
      id: t.id,
      roomId: t.roomId,
      roomName: t.roomName,
      roomCode: t.roomCode,
      createdBy: t.createdByName,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      maxUses: t.maxUses,
      uses: t.uses,
      revokedAt: t.revokedAt,
      state: tokenState(t, now),
    };
  }

  createToken(
    input: { roomId: number; expiresHours?: number; maxUses?: number },
    actor: Actor,
  ): CreatedEnrollmentToken {
    const room = this.d.rooms.get(input.roomId);
    if (!room) throw new AppError('NOT_FOUND');
    const now = this.d.clock.now();
    const token = randomBytes(24).toString('base64url');
    const expiresAt =
      now + (input.expiresHours ?? this.d.settings.get('enrollment.tokenExpiryHours')) * HOUR;
    const maxUses = input.maxUses ?? this.d.settings.get('enrollment.tokenMaxUses');
    const id = this.d.transaction(() => {
      const created = this.d.repo.insertToken({
        tokenHash: sha256Hex(token),
        roomId: room.id,
        createdBy: actor.id,
        createdAt: now,
        expiresAt,
        maxUses,
      });
      this.d.audit.record({
        actor,
        action: 'enrollment.token_create',
        target: `room:${room.name}`,
        details: { tokenId: created, expiresAt, maxUses },
      });
      return created;
    });
    const stored = this.d.repo.getToken(id);
    if (!stored) throw new AppError('INTERNAL_ERROR');
    return { ...this.view(stored, now), token };
  }

  listTokens(): EnrollmentToken[] {
    const now = this.d.clock.now();
    return this.d.repo
      .listTokens(now - LIST_DAYS * 24 * HOUR, now, 200)
      .map((t) => this.view(t, now));
  }

  revokeToken(id: number, actor: Actor): EnrollmentToken {
    const now = this.d.clock.now();
    const t = this.d.repo.getToken(id);
    if (!t) throw new AppError('NOT_FOUND');
    if (t.revokedAt === null) {
      this.d.transaction(() => {
        this.d.repo.revoke(id, now);
        this.d.audit.record({
          actor,
          action: 'enrollment.token_revoke',
          target: `room:${t.roomName}`,
          details: { tokenId: id, uses: t.uses },
        });
      });
    }
    return this.view(this.d.repo.getToken(id) ?? t, now);
  }

  async addresses(): Promise<EnrollmentAddresses> {
    const usable = (await this.d.interfaces.list()).filter(
      (i) => !i.internal && !isLoopback(i.address) && !isApipa(i.address),
    );
    const addresses = usable.map((i) => ({
      address: i.address,
      interfaceName: i.name,
      hasGateway: i.gateway !== null,
    }));
    const remembered = this.d.settings.get('enrollment.hubAddress');
    const selected =
      addresses.find((a) => a.address === remembered)?.address ??
      addresses.find((a) => a.hasGateway)?.address ??
      addresses[0]?.address ??
      null;
    return { addresses, selected, agentPort: this.d.agentPort };
  }

  /** SHA-256 of the bytes the agent listener serves (cached per buffer). */
  scriptHash(): { bytes: Buffer; sha256: string } {
    const bytes = this.d.script.bytes();
    if (!bytes) throw new AppError('PREPARE_SCRIPT_MISSING');
    if (this.hashed?.bytes !== bytes) this.hashed = { bytes, sha256: sha256Hex(bytes) };
    return this.hashed;
  }

  /** Builds the one-liner for a token shown moments ago; remembers the chosen address. */
  command(input: { token: string; address: string }, actor: Actor): EnrollmentCommand {
    const now = this.d.clock.now();
    const t = this.d.repo.findByHash(sha256Hex(input.token));
    if (!t) throw new AppError('ENROLL_TOKEN_INVALID');
    const err = tokenError(tokenState(t, now));
    if (err) throw err;
    const { sha256 } = this.scriptHash();
    const hubUrl = `http://${input.address}:${this.d.agentPort}`;
    const scriptUrl = `${hubUrl}/agent/prepare-target.ps1`;
    const command = buildCommand({
      scriptUrl,
      hubUrl,
      sha256,
      roomCode: t.roomCode,
      token: input.token,
    });
    this.d.transaction(() => {
      if (this.d.settings.get('enrollment.hubAddress') !== input.address) {
        this.d.settings.update({ 'enrollment.hubAddress': input.address }, actor.id);
      }
      this.d.audit.record({
        actor,
        action: 'enrollment.command',
        target: `room:${t.roomName}`,
        details: { tokenId: t.id, address: input.address },
      });
    });
    return { command, hubUrl, scriptUrl, sha256, roomCode: t.roomCode };
  }
}
