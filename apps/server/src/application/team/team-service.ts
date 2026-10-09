/**
 * Team membership and keys (FR-201.4–.5, ADR-037, ADR-038). Keys live DPAPI-protected in the
 * machine-local `team` row and in memory once unlocked; members are a replicated entity, so a
 * rename or a revocation reaches every PC like any other change.
 */
import { createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock, Logger, SecretProtector } from '../ports';

export interface TeamRow {
  teamId: string;
  epoch: number;
  keyBlob: Buffer;
  prevEpoch: number | null;
  prevKeyBlob: Buffer | null;
  memberSecretBlob: Buffer;
  joinedAt: number;
}

export interface MemberRow {
  instanceId: string;
  name: string;
  verifier: string;
  joinedAt: number;
  revokedAt: number | null;
}

export interface PeerRow {
  instanceId: string;
  address: string | null;
  manualAddress: string | null;
  port: number | null;
  lastSeenAt: number | null;
  lastSyncAt: number | null;
  lastError: string | null;
  pulledSeq: number;
  ackedSeq: number;
}

export interface ConflictRow {
  id: number;
  at: number;
  entity: string;
  entityId: string;
  label: string;
  kind: string;
  kept: unknown;
  discarded: unknown;
  winnerInstance: string | null;
}

export interface TeamRepo {
  team(): TeamRow | undefined;
  saveTeam(t: TeamRow): void;
  /** Leaves the team: keys, peers and the member list go (machine-local; nothing is tombstoned). */
  clearTeam(): void;
  members(): MemberRow[];
  member(instanceId: string): MemberRow | undefined;
  /** Inserts or updates a member through the change log (replicated). */
  saveMember(m: MemberRow): void;
  peers(): PeerRow[];
  peer(instanceId: string): PeerRow | undefined;
  savePeer(p: Partial<PeerRow> & { instanceId: string }): void;
  conflicts(limit: number): ConflictRow[];
  addConflicts(c: readonly Omit<ConflictRow, 'id' | 'at'>[], at: number): void;
}

export interface TeamKeys {
  teamId: string;
  epoch: number;
  key: Buffer;
  prevEpoch: number | null;
  prevKey: Buffer | null;
  memberSecret: Buffer;
}

/** What the inviter hands the joiner inside the encrypted pairing box (FR-201.3). */
export interface TeamGrant {
  teamId: string;
  epoch: number;
  key: string;
  prevEpoch: number | null;
  prevKey: string | null;
  memberSecret: string;
}

export const verifierOf = (secret: Buffer) => createHash('sha256').update(secret).digest('hex');
export const teamHash = (teamId: string) =>
  createHash('sha256').update(`uniwake team ${teamId}`).digest('hex').slice(0, 32);
const keyHash = (k: Buffer) => createHash('sha256').update(k).digest('hex');
/** ADR-038: the TLS PSK of one key epoch. */
export const derivePsk = (key: Buffer, teamId: string) =>
  Buffer.from(hkdfSync('sha256', key, Buffer.from(teamId), 'uniwake sync psk', 32));

export interface TeamServiceDeps {
  repo: TeamRepo;
  protector: SecretProtector;
  clock: Clock;
  audit: AuditService;
  logger: Logger;
  instanceId: () => string;
  /** This PC's display name (Windows computer name by default). */
  machineName: string;
}

export class TeamService {
  private keys: TeamKeys | null = null;

  constructor(private readonly d: TeamServiceDeps) {}

  /** Unlocks the keys at start-up (DPAPI). A blob that no longer opens leaves the team. */
  async init(): Promise<void> {
    const t = this.d.repo.team();
    if (!t) return;
    try {
      this.keys = {
        teamId: t.teamId,
        epoch: t.epoch,
        key: await this.d.protector.unprotect(t.keyBlob),
        prevEpoch: t.prevEpoch,
        prevKey: t.prevKeyBlob ? await this.d.protector.unprotect(t.prevKeyBlob) : null,
        memberSecret: await this.d.protector.unprotect(t.memberSecretBlob),
      };
    } catch (e) {
      this.d.logger.error(
        { err: (e as Error).message },
        'team keys could not be unlocked; team mode is off',
      );
      this.keys = null;
    }
  }

  inTeam(): boolean {
    return this.keys !== null;
  }

  self(): { instanceId: string; name: string } {
    const me = this.d.repo.member(this.d.instanceId());
    return { instanceId: this.d.instanceId(), name: me?.name ?? this.d.machineName };
  }

  teamId(): string | null {
    return this.keys?.teamId ?? null;
  }

  epoch(): number | null {
    return this.keys?.epoch ?? null;
  }

  previousEpoch(): number | null {
    return this.keys?.prevEpoch ?? null;
  }

  memberSecret(): Buffer {
    if (!this.keys) throw new AppError('TEAM_NOT_IN_TEAM');
    return this.keys.memberSecret;
  }

  private async persist(k: TeamKeys, joinedAt: number): Promise<void> {
    const p = this.d.protector;
    this.d.repo.saveTeam({
      teamId: k.teamId,
      epoch: k.epoch,
      keyBlob: await p.protect(k.key),
      prevEpoch: k.prevEpoch,
      prevKeyBlob: k.prevKey ? await p.protect(k.prevKey) : null,
      memberSecretBlob: await p.protect(k.memberSecret),
      joinedAt,
    });
    this.keys = k;
  }

  /** The first "Parear com outro PC" on a PC without a team creates it (F7-04). */
  async ensureTeam(): Promise<void> {
    if (this.keys) return;
    const now = this.d.clock.now();
    const memberSecret = randomBytes(32);
    await this.persist(
      {
        teamId: randomUUID(),
        epoch: 1,
        key: randomBytes(32),
        prevEpoch: null,
        prevKey: null,
        memberSecret,
      },
      now,
    );
    this.d.repo.saveMember({
      instanceId: this.d.instanceId(),
      name: this.d.machineName,
      verifier: verifierOf(memberSecret),
      joinedAt: now,
      revokedAt: null,
    });
  }

  /** What the inviter gives a new member: the current keys and a fresh member secret. */
  grantFor(): { grant: TeamGrant; memberSecret: Buffer } {
    if (!this.keys) throw new AppError('TEAM_NOT_IN_TEAM');
    const memberSecret = randomBytes(32);
    return {
      memberSecret,
      grant: {
        teamId: this.keys.teamId,
        epoch: this.keys.epoch,
        key: this.keys.key.toString('base64'),
        prevEpoch: this.keys.prevEpoch,
        prevKey: this.keys.prevKey?.toString('base64') ?? null,
        memberSecret: memberSecret.toString('base64'),
      },
    };
  }

  /** The joiner stores what it was granted (after the team's data replaced its own). */
  async adopt(grant: TeamGrant): Promise<void> {
    await this.persist(
      {
        teamId: grant.teamId,
        epoch: grant.epoch,
        key: Buffer.from(grant.key, 'base64'),
        prevEpoch: grant.prevEpoch,
        prevKey: grant.prevKey ? Buffer.from(grant.prevKey, 'base64') : null,
        memberSecret: Buffer.from(grant.memberSecret, 'base64'),
      },
      this.d.clock.now(),
    );
  }

  registerMember(instanceId: string, name: string, memberSecret: Buffer): void {
    this.d.repo.saveMember({
      instanceId,
      name: name.slice(0, 64),
      verifier: verifierOf(memberSecret),
      joinedAt: this.d.clock.now(),
      revokedAt: null,
    });
  }

  // ---------------------------------------------------------------- transport keys (ADR-038)
  identity(epoch: number): string {
    return `uniwake/1/${this.d.instanceId()}/${epoch}`;
  }

  static parseIdentity(identity: string): { instanceId: string; epoch: number } | null {
    const m = /^uniwake\/1\/([0-9a-f-]{36})\/(\d{1,9})$/.exec(identity);
    return m ? { instanceId: m[1]!, epoch: Number(m[2]) } : null;
  }

  psk(epoch: number): Buffer | null {
    const k = this.keys;
    if (!k) return null;
    const key = epoch === k.epoch ? k.key : epoch === k.prevEpoch ? k.prevKey : null;
    return key ? derivePsk(key, k.teamId) : null;
  }

  /** TLS server side: the PSK for a client identity; unknown or revoked members get none. */
  pskFor(identity: string): Buffer | null {
    const id = TeamService.parseIdentity(identity);
    if (!id) return null;
    const m = this.d.repo.member(id.instanceId);
    if ((m?.revokedAt ?? null) !== null) return null;
    return this.psk(id.epoch);
  }

  /** ADR-038: a member proves itself with its secret; revoked or unknown members never pass. */
  verifyMember(instanceId: string, secretB64: string): boolean {
    const m = this.d.repo.member(instanceId);
    if (!m || m.revokedAt !== null || instanceId === this.d.instanceId()) return false;
    return verifierOf(Buffer.from(secretB64, 'base64')) === m.verifier;
  }

  currentKeyB64(): { epoch: number; key: string } {
    if (!this.keys) throw new AppError('TEAM_NOT_IN_TEAM');
    return { epoch: this.keys.epoch, key: this.keys.key.toString('base64') };
  }

  /** A newer key from a verified member; concurrent rotations converge on (epoch, key hash). */
  async acceptRekey(epoch: number, keyB64: string): Promise<boolean> {
    const k = this.keys;
    if (!k) return false;
    const key = Buffer.from(keyB64, 'base64');
    if (key.length !== 32) return false;
    const newer = epoch > k.epoch || (epoch === k.epoch && keyHash(key) > keyHash(k.key));
    if (!newer) return false;
    await this.persist(
      { ...k, epoch, key, prevEpoch: k.epoch, prevKey: k.key },
      this.d.clock.now(),
    );
    this.d.logger.info({ epoch }, 'team key rotated by a peer');
    return true;
  }

  /** Where a member was last reached (announcement, pairing, a session). */
  seenPeer(instanceId: string, address: string, port: number, extra: Partial<PeerRow> = {}): void {
    if (instanceId === this.d.instanceId()) return;
    this.d.repo.savePeer({ instanceId, address, port, lastSeenAt: this.d.clock.now(), ...extra });
  }

  peers(): PeerRow[] {
    return this.d.repo.peers();
  }

  peer(instanceId: string): PeerRow | undefined {
    return this.d.repo.peer(instanceId);
  }

  updatePeer(p: Partial<PeerRow> & { instanceId: string }): void {
    this.d.repo.savePeer(p);
  }

  // ---------------------------------------------------------------- members (admin)
  members(): MemberRow[] {
    return this.d.repo.members();
  }

  rename(instanceId: string, name: string, actor: Actor): void {
    const m = this.d.repo.member(instanceId);
    if (!m) throw new AppError('TEAM_MEMBER_NOT_FOUND');
    this.d.repo.saveMember({ ...m, name });
    this.d.audit.record({
      actor,
      action: 'team.rename',
      target: `member:${instanceId}`,
      details: { name },
    });
  }

  setAddress(instanceId: string, address: string | null, actor: Actor): void {
    if (!this.d.repo.member(instanceId)) throw new AppError('TEAM_MEMBER_NOT_FOUND');
    this.d.repo.savePeer({ instanceId, manualAddress: address });
    this.d.audit.record({
      actor,
      action: 'team.address',
      target: `member:${instanceId}`,
      details: { address },
    });
  }

  /** Revocation (FR-201.5): replicated mark + key rotation; returns the new epoch. */
  async revoke(instanceId: string, actor: Actor): Promise<number> {
    if (!this.keys) throw new AppError('TEAM_NOT_IN_TEAM');
    if (instanceId === this.d.instanceId()) throw new AppError('TEAM_CANNOT_REVOKE_SELF');
    const m = this.d.repo.member(instanceId);
    if (!m) throw new AppError('TEAM_MEMBER_NOT_FOUND');
    this.d.repo.saveMember({ ...m, revokedAt: this.d.clock.now() });
    const k = this.keys;
    await this.persist(
      { ...k, epoch: k.epoch + 1, key: randomBytes(32), prevEpoch: k.epoch, prevKey: k.key },
      this.d.clock.now(),
    );
    this.d.audit.record({
      actor,
      action: 'team.revoke',
      target: `member:${instanceId}`,
      details: { name: m.name, epoch: k.epoch + 1 },
    });
    return k.epoch + 1;
  }

  /** "Sair da equipe": forget keys and peers; the data stays on this PC. */
  leave(actor: Actor, reason: 'requested' | 'revoked' = 'requested'): void {
    if (!this.keys) return;
    this.d.repo.clearTeam();
    this.keys = null;
    this.d.audit.record({ actor, action: 'team.leave', target: 'team', details: { reason } });
  }

  addConflicts(c: readonly Omit<ConflictRow, 'id' | 'at'>[]): void {
    this.d.repo.addConflicts(c, this.d.clock.now());
  }

  conflicts(limit = 200): ConflictRow[] {
    return this.d.repo.conflicts(limit);
  }

  /** True when the replicated member list says this PC was revoked. */
  selfRevoked(): boolean {
    return (this.d.repo.member(this.d.instanceId())?.revokedAt ?? null) !== null;
  }
}
