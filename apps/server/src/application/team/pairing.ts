/**
 * Pairing (FR-201.1–.3, ADR-035, ADR-036). The PC that shows the code (inviter, role A) keeps its
 * data; the PC that types it (joiner, role B) adopts the team's. The code only feeds SPAKE2: it never
 * travels, and each wrong guess costs one of 5 attempts.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock, Logger, MessageChannel, SyncEndpoint, SyncNetwork } from '../ports';
import {
  grantSchema,
  pairConfirm,
  pairDone,
  pairError,
  pairFinish,
  pairHello,
  pairStart,
  PROTOCOL_VERSION,
} from './protocol';
import type { ChangeEntry, ReplicaStore } from './replica';
import { spake2 } from './spake2';
import type { TeamGrant, TeamService } from './team-service';

export const CODE_TTL_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 5;
const STEP_TIMEOUT_MS = 15_000;
const PER_IP_PER_MINUTE = 10;

export function pairingContext(nonceA: string, nonceB: string): Buffer {
  return Buffer.from(`UniWake pairing v${PROTOCOL_VERSION}|${nonceA}|${nonceB}`);
}

interface Box {
  iv: string;
  tag: string;
  data: string;
}

export function seal(key: Buffer, value: unknown): Box {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return {
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function unseal(key: Buffer, box: Box): unknown {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  const plain = Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]);
  return JSON.parse(plain.toString('utf8')) as unknown;
}

interface OpenCode {
  code: string;
  expiresAt: number;
  attempts: number;
  busy: boolean;
}

export interface PairingDeps {
  team: TeamService;
  network: SyncNetwork;
  replica: ReplicaStore;
  clock: Clock;
  audit: AuditService;
  logger: Logger;
  /** Starts the team listener (pairing + sync) and returns its port. */
  ensureListening: () => Promise<number>;
  /** Joiner: the team's full state over a TLS session opened with the granted keys (D7-01). */
  fetchTeamState: (
    to: SyncEndpoint,
    grant: TeamGrant,
    inviter: string,
  ) => Promise<{ entries: ChangeEntry[]; seq: number }>;
  /** Backup before the joiner's data is replaced (FR-201.2). */
  backupBeforeJoin: () => void;
  /** After the team changed on this PC (paired someone, joined): start syncing, refresh panels. */
  onTeamChanged: () => void;
  /** This PC's sync port as other PCs should use it. */
  defaultPort: number;
}

export interface PairingView {
  open: boolean;
  code: string | null;
  expiresAt: number | null;
  attemptsLeft: number;
}

export interface JoinInput {
  address: string;
  port?: number | undefined;
  code: string;
  confirm?: string | undefined;
}

export class PairingService {
  private open: OpenCode | null = null;
  private readonly perIp = new Map<string, number[]>();

  constructor(private readonly d: PairingDeps) {}

  // ---------------------------------------------------------------- inviter
  /** FR-201.1: a new 6-digit code (cancels any previous one). */
  async openCode(actor: Actor): Promise<PairingView> {
    if (!this.d.team.inTeam()) await this.d.team.ensureTeam();
    await this.d.ensureListening();
    this.open = {
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      expiresAt: this.d.clock.now() + CODE_TTL_MS,
      attempts: 0,
      busy: false,
    };
    this.d.audit.record({ actor, action: 'team.pairing_open', target: 'team' });
    // Smoke-test finding: the first code creates the team, so start the loops now; otherwise the PC
    // would announce its open pairing only once and the joiner's list would stay empty.
    this.d.onTeamChanged();
    return this.view();
  }

  cancel(): void {
    this.open = null;
  }

  view(): PairingView {
    const o = this.current();
    return o
      ? {
          open: true,
          code: o.code,
          expiresAt: o.expiresAt,
          attemptsLeft: MAX_ATTEMPTS - o.attempts,
        }
      : { open: false, code: null, expiresAt: null, attemptsLeft: 0 };
  }

  /** The open code, if still valid. */
  current(): OpenCode | null {
    if (this.open && this.d.clock.now() >= this.open.expiresAt) this.open = null;
    return this.open;
  }

  private rateLimited(ip: string): boolean {
    const now = this.d.clock.now();
    const recent = (this.perIp.get(ip) ?? []).filter((t) => t > now - 60_000);
    recent.push(now);
    this.perIp.set(ip, recent);
    // M11-D: forget addresses that went quiet, so the map cannot grow without bound.
    for (const [k, v] of this.perIp) if (v.every((t) => t <= now - 60_000)) this.perIp.delete(k);
    return recent.length > PER_IP_PER_MINUTE;
  }

  /** A pairing connection arrived on the team port (R7-01: answers only while a code is open). */
  async handleIncoming(ch: MessageChannel): Promise<void> {
    const fail = (
      code: 'no_code' | 'wrong_code' | 'locked' | 'busy' | 'bad_message',
      attemptsLeft?: number,
    ) => {
      ch.send({
        type: 'pair.error',
        code,
        ...(attemptsLeft !== undefined ? { attemptsLeft } : {}),
      });
      ch.close();
    };
    try {
      if (this.rateLimited(ch.remoteAddress)) return fail('busy');
      const hello = pairHello.safeParse(await ch.receive(STEP_TIMEOUT_MS));
      if (!hello.success) return fail('bad_message');
      const open = this.current();
      if (!open) return fail('no_code');
      if (open.busy) return fail('busy');
      open.busy = true;
      try {
        await this.invite(ch, hello.data, open, fail);
      } finally {
        open.busy = false;
      }
    } catch (e) {
      this.d.logger.warn(
        { err: (e as Error).message, from: ch.remoteAddress },
        'pairing connection failed',
      );
      ch.close();
    }
  }

  private async invite(
    ch: MessageChannel,
    hello: { instance: string; name: string; nonce: string; port?: number | undefined },
    open: OpenCode,
    fail: (code: 'wrong_code' | 'locked' | 'bad_message', attemptsLeft?: number) => void,
  ): Promise<void> {
    const self = this.d.team.self();
    const nonce = randomBytes(16).toString('base64');
    const ctx = pairingContext(nonce, hello.nonce);
    const party = spake2('A', open.code, { idA: self.instanceId, idB: hello.instance }, ctx);
    ch.send({
      type: 'pair.start',
      instance: self.instanceId,
      name: self.name,
      nonce,
      pA: party.message.toString('base64'),
    });
    const fin = pairFinish.safeParse(await ch.receive(STEP_TIMEOUT_MS));
    if (!fin.success) return fail('bad_message');
    let keys;
    try {
      keys = party.finish(Buffer.from(fin.data.pB, 'base64'));
    } catch {
      return fail('bad_message');
    }
    if (!keys.verifyPeer(Buffer.from(fin.data.cB, 'base64'))) {
      open.attempts++;
      const left = MAX_ATTEMPTS - open.attempts;
      this.d.audit.record({
        actor: { id: null, label: `pc:${hello.name}` },
        action: 'team.pair',
        target: `member:${hello.instance}`,
        result: 'error',
        sourceIp: ch.remoteAddress,
        details: { reason: 'wrong_code', attemptsLeft: left },
      });
      if (left <= 0) {
        this.open = null;
        return fail('locked');
      }
      return fail('wrong_code', left);
    }
    const { grant, memberSecret } = this.d.team.grantFor();
    ch.send({
      type: 'pair.confirm',
      cA: keys.confirm.toString('base64'),
      box: seal(keys.key, grant),
    });
    const done = pairDone.safeParse(await ch.receive(STEP_TIMEOUT_MS));
    if (!done.success) return fail('bad_message');
    this.d.team.registerMember(hello.instance, hello.name, memberSecret);
    this.d.team.seenPeer(hello.instance, ch.remoteAddress, hello.port ?? this.d.defaultPort);
    this.open = null; // single use
    ch.close();
    this.d.audit.record({
      actor: { id: null, label: `pc:${hello.name}` },
      action: 'team.pair',
      target: `member:${hello.instance}`,
      sourceIp: ch.remoteAddress,
      details: { name: hello.name },
    });
    this.d.onTeamChanged();
  }

  // ---------------------------------------------------------------- joiner
  /** FR-201.2: joins the team of the PC at `address` with the code it shows. */
  async join(input: JoinInput, actor: Actor): Promise<{ members: number }> {
    if (this.d.team.inTeam()) throw new AppError('TEAM_ALREADY_MEMBER');
    const counts = this.d.replica.replicatedCounts();
    const hasData = counts.rooms + counts.devices + counts.tags + counts.schedules > 0;
    if (hasData && input.confirm !== 'SUBSTITUIR') {
      throw new AppError('TEAM_REPLACE_CONFIRM', {}, counts);
    }
    const myPort = await this.d.ensureListening();
    const to = { host: input.address, port: input.port ?? this.d.defaultPort };
    let ch: MessageChannel;
    try {
      ch = await this.d.network.connectPairing(to, STEP_TIMEOUT_MS);
    } catch {
      throw new AppError('TEAM_PAIRING_UNREACHABLE', { address: input.address });
    }
    let grant: TeamGrant;
    let inviter: string;
    try {
      ({ grant, inviter } = await this.exchange(ch, input.code, myPort));
    } finally {
      ch.close();
    }
    let state: { entries: ChangeEntry[]; seq: number };
    try {
      state = await this.d.fetchTeamState(to, grant, inviter);
    } catch (e) {
      this.d.logger.warn(
        { err: (e as Error).message },
        'joined but could not fetch the team state',
      );
      throw new AppError('TEAM_PAIRING_FAILED');
    }
    if (hasData || counts.users > 0) this.d.backupBeforeJoin();
    const now = this.d.clock.now();
    this.d.replica.replace(state.entries, now);
    await this.d.team.adopt(grant);
    this.d.team.seenPeer(inviter, to.host, to.port, { pulledSeq: state.seq, lastSyncAt: now });
    this.d.audit.record({
      actor,
      action: 'team.join',
      target: `member:${inviter}`,
      details: { address: input.address, replaced: counts },
    });
    this.d.onTeamChanged();
    return { members: this.d.team.members().length };
  }

  private async exchange(
    ch: MessageChannel,
    code: string,
    myPort: number,
  ): Promise<{ grant: TeamGrant; inviter: string }> {
    const self = this.d.team.self();
    const nonce = randomBytes(16).toString('base64');
    ch.send({
      type: 'pair.hello',
      v: PROTOCOL_VERSION,
      instance: self.instanceId,
      name: self.name,
      nonce,
      port: myPort,
    });
    const first = await this.receiveOrFail(ch);
    const start = pairStart.safeParse(first);
    if (!start.success) throw new AppError('TEAM_PAIRING_FAILED');
    const party = spake2(
      'B',
      code,
      { idA: start.data.instance, idB: self.instanceId },
      pairingContext(start.data.nonce, nonce),
    );
    let keys;
    try {
      keys = party.finish(Buffer.from(start.data.pA, 'base64'));
    } catch {
      throw new AppError('TEAM_PAIRING_FAILED');
    }
    ch.send({
      type: 'pair.finish',
      pB: party.message.toString('base64'),
      cB: keys.confirm.toString('base64'),
    });
    const confirm = pairConfirm.safeParse(await this.receiveOrFail(ch));
    if (!confirm.success || !keys.verifyPeer(Buffer.from(confirm.data.cA, 'base64'))) {
      throw new AppError('TEAM_PAIRING_FAILED');
    }
    let grant: TeamGrant;
    try {
      grant = grantSchema.parse(unseal(keys.key, confirm.data.box));
    } catch {
      throw new AppError('TEAM_PAIRING_FAILED');
    }
    ch.send({ type: 'pair.done' });
    return { grant, inviter: start.data.instance };
  }

  private async receiveOrFail(ch: MessageChannel): Promise<unknown> {
    let msg: unknown;
    try {
      msg = await ch.receive(STEP_TIMEOUT_MS);
    } catch {
      throw new AppError('TEAM_PAIRING_FAILED');
    }
    const err = pairError.safeParse(msg);
    if (err.success) {
      switch (err.data.code) {
        case 'no_code':
          throw new AppError('TEAM_PAIRING_NO_CODE');
        case 'wrong_code':
          throw new AppError('TEAM_PAIRING_WRONG_CODE', {
            attemptsLeft: err.data.attemptsLeft ?? 0,
          });
        case 'locked':
          throw new AppError('TEAM_PAIRING_LOCKED');
        default:
          throw new AppError('TEAM_PAIRING_FAILED');
      }
    }
    return msg;
  }
}
