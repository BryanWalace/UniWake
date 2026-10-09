/**
 * Team sync (FR-202, ADR-035, ADR-038, plan §14.4). Pull only: this PC asks each online peer for
 * "changes since N" and applies them in one transaction; a poke asks a peer to pull now. Sessions run
 * over TLS 1.3 PSK, then both sides prove membership; the side with the older key epoch receives the
 * newer key and reconnects.
 */
import type { Actor, AuditService } from '../audit/audit-service';
import type { EventsBus } from '../events-bus';
import type { NoticesService } from '../notices/notices-service';
import type {
  Clock,
  Logger,
  MessageChannel,
  NetworkInterfaces,
  SyncEndpoint,
  SyncNetwork,
  TimerHandle,
} from '../ports';
import type { SettingsService } from '../settings/settings-service';
import { subnetBroadcast, LIMITED_BROADCAST } from '../../domain/network';
import type { PairingService } from './pairing';
import {
  announcement,
  type Announcement,
  changesMsg,
  errorMsg,
  PROTOCOL_VERSION,
  rekeyMsg,
  sessionRequest,
  syncHello,
} from './protocol';
import type { ChangeEntry, ReplicaStore } from './replica';
import {
  derivePsk,
  type MemberRow,
  type PeerRow,
  teamHash,
  type TeamGrant,
  TeamService,
} from './team-service';

export const ANNOUNCE_MS = 15_000;
export const SYNC_MS = 30_000;
export const POKE_CHECK_MS = 2_000;
export const ONLINE_MS = 60_000;
export const TOMBSTONE_TTL_MS = 30 * 86_400_000;
const HANDSHAKE_MS = 10_000;
const REQUEST_MS = 60_000;
const SYSTEM: Actor = { id: null, label: 'sistema' };

export interface SyncServiceDeps {
  team: TeamService;
  replica: ReplicaStore;
  network: SyncNetwork;
  interfaces: NetworkInterfaces;
  settings: SettingsService;
  notices: NoticesService;
  events: EventsBus;
  audit: AuditService;
  clock: Clock;
  logger: Logger;
  /** TCP+UDP port to listen on (0 = ephemeral, tests). */
  port: number;
  /** The port other PCs use by default (FR-202: the same everywhere). */
  defaultPort: number;
  /** Tests: where announcements go instead of the subnets' broadcast addresses. */
  announceTargets?: () => readonly SyncEndpoint[];
}

export interface MemberStatus {
  instanceId: string;
  name: string;
  self: boolean;
  revoked: boolean;
  online: boolean;
  address: string | null;
  manualAddress: string | null;
  lastSeenAt: number | null;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Local changes this PC has not acknowledged yet (FR-202.6). */
  pending: number;
}

export interface DiscoveredPc {
  instanceId: string;
  name: string;
  address: string;
  port: number;
  seenAt: number;
}

/** Operator-facing reason of a failed sync, pt-BR (constitution §8). */
function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|timeout/i.test(msg)) {
    return 'Sem conexão: o PC está desligado, o UniWake não está rodando ou a porta 47102 está bloqueada no firewall.';
  }
  if (/not_member/.test(msg))
    return 'O outro PC não reconhece este como membro da equipe (foi removido?).';
  if (/SSL|TLS|handshake|alert|decrypt/i.test(msg)) {
    return 'As chaves da equipe não conferem. Se este PC ficou desligado durante duas trocas de chave, pareie de novo.';
  }
  return `Falha na sincronização: ${msg}`;
}

export class SyncService {
  private tcpPort: number | null = null;
  private udpPort: number | null = null;
  private listening: Promise<number> | null = null;
  private udpListening: Promise<number> | null = null;
  private readonly timers = new Map<string, TimerHandle>();
  private readonly inflight = new Map<string, Promise<void>>();
  private lastPokedSeq = 0;
  private readonly discovered = new Map<string, DiscoveredPc>();
  private pairing: PairingService | null = null;
  private running = false;

  constructor(private readonly d: SyncServiceDeps) {}

  network(): SyncNetwork {
    return this.d.network;
  }

  /** Wires the pairing service (they depend on each other). */
  attachPairing(p: PairingService): void {
    this.pairing = p;
  }

  // ---------------------------------------------------------------- lifecycle
  /** Starts listening and the loops when this PC is in a team. Idempotent. */
  async start(): Promise<void> {
    if (!this.d.team.inTeam() || this.running) return;
    this.running = true;
    await this.ensureListening();
    this.lastPokedSeq = this.d.replica.maxSeq();
    this.every('announce', ANNOUNCE_MS, () => this.announce());
    this.every('sync', SYNC_MS, () => this.syncAll(false));
    this.every('poke', POKE_CHECK_MS, () => this.pokeIfChanged());
    this.every('prune', 3_600_000, () => this.pruneTombstones());
    void this.announce();
    void this.syncAll(false);
  }

  stop(): void {
    for (const t of this.timers.values()) this.d.clock.clearTimeout(t);
    this.timers.clear();
    this.running = false;
  }

  /** A repeating timer on the Clock port (re-armed after each run; errors are logged). */
  private every(name: string, ms: number, fn: () => unknown): void {
    const arm = () => {
      this.timers.set(
        name,
        this.d.clock.setTimeout(() => {
          if (!this.running) return;
          void Promise.resolve()
            .then(fn)
            .catch((e: Error) =>
              this.d.logger.warn({ err: e.message, timer: name }, 'team timer failed'),
            )
            .finally(() => {
              if (this.running) arm();
            });
        }, ms),
      );
    };
    arm();
  }

  async close(): Promise<void> {
    this.stop();
    await Promise.allSettled([...this.inflight.values()]);
    await this.d.network.close();
    this.listening = null;
    this.udpListening = null;
  }

  /** TCP (pairing + sync) and UDP (announcements) on the team port. */
  ensureListening(): Promise<number> {
    this.listening ??= this.d.network
      .listen(this.d.port, {
        onPairing: (ch) => void this.pairing?.handleIncoming(ch),
        pskFor: (identity) => this.d.team.pskFor(identity),
        onSync: (ch, identity) => void this.serve(ch, identity),
      })
      .then((p) => (this.tcpPort = p));
    void this.ensureUdp();
    return this.listening;
  }

  /** UDP only: the join screen lists PCs with an open pairing (FR-201.2). */
  ensureUdp(): Promise<number> {
    this.udpListening ??= this.d.network
      .listenAnnouncements(this.d.port === 0 ? 0 : this.d.port, (msg, from) =>
        this.onAnnouncement(msg, from),
      )
      .then((p) => (this.udpPort = p))
      .catch((e: Error) => {
        this.d.logger.warn({ err: e.message }, 'team announcements disabled (UDP port in use)');
        this.udpListening = null;
        return 0;
      });
    return this.udpListening;
  }

  defaultPort(): number {
    return this.d.defaultPort;
  }

  /** This PC's LAN IPv4 addresses (shown next to the pairing code). */
  async localAddresses(): Promise<string[]> {
    return (await this.d.interfaces.list()).filter((i) => !i.internal).map((i) => i.address);
  }

  ports(): { tcp: number | null; udp: number | null } {
    return { tcp: this.tcpPort, udp: this.udpPort };
  }

  // ---------------------------------------------------------------- discovery (FR-202.1)
  private async targets(): Promise<SyncEndpoint[]> {
    if (this.d.announceTargets) return [...this.d.announceTargets()];
    const out = new Set<string>([LIMITED_BROADCAST]);
    for (const i of await this.d.interfaces.list()) {
      if (i.internal) continue;
      const b = subnetBroadcast(i.address, i.prefixLength);
      if (b) out.add(b);
    }
    return [...out].map((host) => ({ host, port: this.d.defaultPort }));
  }

  /** What this PC tells the LAN: never data, keys or the team id (AC-202-03). */
  announcementMessage(): Announcement {
    const teamId = this.d.team.teamId();
    const open = this.pairing?.current();
    return {
      app: 'uniwake',
      v: PROTOCOL_VERSION,
      instance: this.d.team.self().instanceId,
      port: this.tcpPort ?? this.d.defaultPort,
      ...(teamId ? { team: teamHash(teamId) } : {}),
      seq: this.d.replica.maxSeq(),
      ...(open ? { pairing: { name: this.d.team.self().name } } : {}),
    };
  }

  async announce(): Promise<void> {
    if (!this.d.team.inTeam() && !this.pairing?.current()) return;
    try {
      await this.d.network.announce(this.announcementMessage(), await this.targets());
    } catch (e) {
      this.d.logger.debug({ err: (e as Error).message }, 'announcement failed');
    }
  }

  private onAnnouncement(raw: unknown, from: string): void {
    const parsed = announcement.safeParse(raw);
    if (!parsed.success) return;
    const a = parsed.data;
    if (a.instance === this.d.team.self().instanceId) return;
    const now = this.d.clock.now();
    if (a.pairing) {
      this.discovered.set(a.instance, {
        instanceId: a.instance,
        name: a.pairing.name,
        address: from,
        port: a.port,
        seenAt: now,
      });
      // M12-D: spoofed announcements cannot grow the list without bound (keep the 20 newest).
      for (const [k, v] of this.discovered) if (v.seenAt < now - 30_000) this.discovered.delete(k);
      while (this.discovered.size > 20)
        this.discovered.delete(this.discovered.keys().next().value!);
    }
    const teamId = this.d.team.teamId();
    if (!teamId || a.team !== teamHash(teamId)) return;
    const member = this.d.team.members().find((m) => m.instanceId === a.instance);
    if (!member || member.revokedAt !== null) return;
    this.d.team.seenPeer(a.instance, from, a.port);
    const peer = this.d.team.peer(a.instance);
    if (peer && a.seq > peer.pulledSeq) void this.pullFrom(a.instance);
  }

  /** PCs announcing an open pairing in the last 30 s (join screen). */
  discoveredPairing(): DiscoveredPc[] {
    const since = this.d.clock.now() - 30_000;
    return [...this.discovered.values()]
      .filter((p) => p.seenAt >= since)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- status (FR-202.6)
  private endpoint(p: PeerRow | undefined): SyncEndpoint | null {
    const host = p?.manualAddress ?? p?.address;
    return host ? { host, port: p?.port ?? this.d.defaultPort } : null;
  }

  isOnline(p: PeerRow | undefined, now = this.d.clock.now()): boolean {
    const seen = p?.lastSeenAt ?? null;
    return seen !== null && seen >= now - ONLINE_MS;
  }

  /** Non-revoked members (other than this PC) seen in the last 60 s (ADR-039). */
  onlineMembers(now = this.d.clock.now()): string[] {
    const self = this.d.team.self().instanceId;
    return this.d.team
      .members()
      .filter(
        (m) =>
          m.instanceId !== self &&
          m.revokedAt === null &&
          this.isOnline(this.d.team.peer(m.instanceId), now),
      )
      .map((m) => m.instanceId);
  }

  status(): {
    inTeam: boolean;
    self: { instanceId: string; name: string };
    epoch: number | null;
    members: MemberStatus[];
  } {
    const self = this.d.team.self();
    const now = this.d.clock.now();
    const members = this.d.team.members().map((m: MemberRow): MemberStatus => {
      const p = this.d.team.peer(m.instanceId);
      const isSelf = m.instanceId === self.instanceId;
      return {
        instanceId: m.instanceId,
        name: m.name,
        self: isSelf,
        revoked: m.revokedAt !== null,
        online: isSelf || this.isOnline(p, now),
        address: p?.address ?? null,
        manualAddress: p?.manualAddress ?? null,
        lastSeenAt: p?.lastSeenAt ?? null,
        lastSyncAt: p?.lastSyncAt ?? null,
        lastError: p?.lastError ?? null,
        pending: isSelf || m.revokedAt !== null ? 0 : this.d.replica.countSince(p?.ackedSeq ?? 0),
      };
    });
    return { inTeam: this.d.team.inTeam(), self, epoch: this.d.team.epoch(), members };
  }

  // ---------------------------------------------------------------- client side
  /** "Sincronizar agora": pull from every reachable member and ask them to pull from us. */
  async syncAll(poke: boolean): Promise<void> {
    if (!this.d.team.inTeam()) return;
    const self = this.d.team.self().instanceId;
    const now = this.d.clock.now();
    const targets = this.d.team
      .members()
      .filter((m) => m.instanceId !== self && m.revokedAt === null)
      .filter((m) => {
        const p = this.d.team.peer(m.instanceId);
        return (
          (p?.manualAddress ?? null) !== null ||
          this.isOnline(p, now) ||
          ((p?.address ?? null) !== null && poke)
        );
      });
    await Promise.allSettled(targets.map((m) => this.pullFrom(m.instanceId, { poke })));
  }

  private pokeIfChanged(): void {
    const seq = this.d.replica.maxSeq();
    if (seq === this.lastPokedSeq) return;
    this.lastPokedSeq = seq;
    void this.syncAll(true);
  }

  /** One session with a peer: pull its changes (and optionally poke it). Never concurrent per peer. */
  pullFrom(instanceId: string, opts: { poke?: boolean } = {}): Promise<void> {
    const running = this.inflight.get(instanceId);
    if (running) return running;
    const p = this.session(instanceId, opts.poke ?? false, 0).finally(() =>
      this.inflight.delete(instanceId),
    );
    this.inflight.set(instanceId, p);
    return p;
  }

  private async connect(to: SyncEndpoint): Promise<{ ch: MessageChannel; epoch: number }> {
    const epochs = [this.d.team.epoch(), this.d.team.previousEpoch()].filter(
      (e): e is number => e !== null,
    );
    let last: unknown = new Error('no key');
    for (const epoch of epochs) {
      const psk = this.d.team.psk(epoch)!;
      try {
        return {
          ch: await this.d.network.connectSync(to, this.d.team.identity(epoch), psk, HANDSHAKE_MS),
          epoch,
        };
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  private hello() {
    return {
      type: 'hello',
      v: PROTOCOL_VERSION,
      instance: this.d.team.self().instanceId,
      epoch: this.d.team.epoch()!,
      memberSecret: this.d.team.memberSecret().toString('base64'),
      seq: this.d.replica.maxSeq(),
    };
  }

  private async session(instanceId: string, poke: boolean, depth: number): Promise<void> {
    if (!this.d.team.inTeam()) return;
    const peer = this.d.team.peer(instanceId);
    const to = this.endpoint(peer);
    if (!to) return;
    let ch: MessageChannel | null = null;
    try {
      ch = (await this.connect(to)).ch;
      ch.send(this.hello());
      const first = await ch.receive(HANDSHAKE_MS);
      const refused = errorMsg.safeParse(first);
      if (refused.success && refused.data.code === 'revoked') {
        // FR-201.5: this PC was removed from the team; it stops syncing and keeps its data.
        this.leaveRevoked();
        return;
      }
      if (refused.success) throw new Error(`refused: ${refused.data.code}`);
      const rekey = rekeyMsg.safeParse(first);
      if (rekey.success) {
        // We were behind: the peer verified us and handed the newer key (ADR-038).
        await this.d.team.acceptRekey(rekey.data.epoch, rekey.data.key);
        ch.close();
        ch = null;
        if (depth < 1) return await this.session(instanceId, poke, depth + 1);
        return;
      }
      const hello = syncHello.parse(first);
      if (
        hello.instance !== instanceId ||
        !this.d.team.verifyMember(hello.instance, hello.memberSecret)
      ) {
        throw new Error('refused: not_member');
      }
      if (hello.epoch < this.d.team.epoch()!) {
        ch.send({ type: 'rekey', ...this.d.team.currentKeyB64() });
        ch.close();
        ch = null;
        return;
      }
      if (hello.epoch > this.d.team.epoch()!) {
        // The peer is ahead and will rekey us on its next contact; nothing more on this session.
        return;
      }
      ch.send({ type: 'pull', since: peer?.pulledSeq ?? 0 });
      const changes = changesMsg.parse(await ch.receive(REQUEST_MS));
      this.applyBatch(instanceId, changes.entries);
      this.d.team.updatePeer({
        instanceId,
        pulledSeq: changes.seq,
        lastSyncAt: this.d.clock.now(),
        lastSeenAt: this.d.clock.now(),
        lastError: null,
      });
      ch.send({ type: 'ack', seq: changes.seq });
      if (poke) ch.send({ type: 'poke' });
      ch.send({ type: 'bye' });
    } catch (e) {
      this.d.team.updatePeer({ instanceId, lastError: describe(e) });
      this.d.logger.debug({ peer: instanceId, err: (e as Error).message }, 'sync session failed');
    } finally {
      ch?.close();
    }
  }

  private applyBatch(from: string, entries: ChangeEntry[]): void {
    if (entries.length === 0) return;
    const peer = this.d.team.peer(from);
    const r = this.d.replica.apply(entries, {
      now: this.d.clock.now(),
      peerAckedSeq: peer?.ackedSeq ?? 0,
      peerInstance: from,
    });
    if (r.conflicts.length > 0) this.d.team.addConflicts(r.conflicts);
    if (r.applied > 0) {
      if (r.touched.has('setting')) this.d.settings.reload();
      this.d.events.publish({ type: 'sync' });
    }
    if (this.d.team.selfRevoked()) this.leaveRevoked();
  }

  private leaveRevoked(): void {
    this.d.team.leave(SYSTEM, 'revoked');
    this.stop();
    this.d.notices.system('team_revoked', {});
    this.d.events.publish({ type: 'sync' });
  }

  /** Joiner (D7-01): the team's full state over a session opened with the granted keys. */
  async fetchWithGrant(
    to: SyncEndpoint,
    grant: TeamGrant,
    inviter: string,
  ): Promise<{ entries: ChangeEntry[]; seq: number }> {
    const key = Buffer.from(grant.key, 'base64');
    const psk = derivePsk(key, grant.teamId);
    const identity = `uniwake/1/${this.d.team.self().instanceId}/${grant.epoch}`;
    let lastError: unknown = null;
    // The inviter registers us right after "pair.done": retry briefly if we raced it.
    for (let attempt = 0; attempt < 5; attempt++) {
      let ch: MessageChannel | null = null;
      try {
        ch = await this.d.network.connectSync(to, identity, psk, HANDSHAKE_MS);
        // Not in the team yet (keys are stored after the data is replaced): hello from the grant.
        ch.send({
          type: 'hello',
          v: PROTOCOL_VERSION,
          instance: this.d.team.self().instanceId,
          epoch: grant.epoch,
          memberSecret: grant.memberSecret,
          seq: this.d.replica.maxSeq(),
        });
        const first = await ch.receive(HANDSHAKE_MS);
        if (errorMsg.safeParse(first).success) throw new Error('refused: not_member');
        const hello = syncHello.parse(first);
        if (hello.instance !== inviter) throw new Error('unexpected peer');
        ch.send({ type: 'pull', since: 0 });
        const changes = changesMsg.parse(await ch.receive(REQUEST_MS));
        ch.send({ type: 'bye' });
        return { entries: changes.entries, seq: changes.seq };
      } catch (e) {
        lastError = e;
        // Transport pacing in real time (not schedule time): the inviter is milliseconds behind.
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        ch?.close();
      }
    }
    throw lastError instanceof Error ? lastError : new Error('fetch failed');
  }

  // ---------------------------------------------------------------- server side
  private async serve(ch: MessageChannel, identity: string): Promise<void> {
    try {
      const hello = syncHello.safeParse(await ch.receive(HANDSHAKE_MS));
      const id = TeamService.parseIdentity(identity);
      if (
        !hello.success ||
        !id ||
        id.instanceId !== hello.data.instance ||
        !this.d.team.verifyMember(hello.data.instance, hello.data.memberSecret)
      ) {
        const revoked =
          hello.success &&
          id?.instanceId === hello.data.instance &&
          this.d.team.isRevokedMember(hello.data.instance, hello.data.memberSecret);
        ch.send({ type: 'error', code: revoked ? 'revoked' : 'not_member' });
        return;
      }
      const client = hello.data.instance;
      const known = this.d.team.peer(client);
      this.d.team.seenPeer(client, ch.remoteAddress, known?.port ?? this.d.defaultPort);
      const ours = this.d.team.epoch()!;
      if (hello.data.epoch < ours) {
        // The client is behind (it connected with our previous key): hand it the new one.
        ch.send({ type: 'rekey', ...this.d.team.currentKeyB64() });
        return;
      }
      ch.send(this.hello());
      for (;;) {
        const req = sessionRequest.safeParse(await ch.receive(REQUEST_MS));
        if (!req.success) return;
        switch (req.data.type) {
          case 'pull': {
            const acked = this.d.team.peer(client)?.ackedSeq ?? 0;
            this.d.team.updatePeer({
              instanceId: client,
              ackedSeq: Math.max(acked, req.data.since),
            });
            const { entries, seq } = this.d.replica.changesSince(req.data.since);
            ch.send({ type: 'changes', entries, seq });
            break;
          }
          case 'ack': {
            const acked = this.d.team.peer(client)?.ackedSeq ?? 0;
            this.d.team.updatePeer({ instanceId: client, ackedSeq: Math.max(acked, req.data.seq) });
            break;
          }
          case 'poke':
            void this.pullFrom(client);
            break;
          case 'rekey':
            await this.d.team.acceptRekey(req.data.epoch, req.data.key);
            return;
          case 'bye':
            return;
        }
      }
    } catch (e) {
      this.d.logger.debug(
        { err: (e as Error).message, from: ch.remoteAddress },
        'sync session ended',
      );
    } finally {
      ch.close();
    }
  }

  // ---------------------------------------------------------------- tombstones (FR-202.5)
  pruneTombstones(): number {
    if (!this.d.team.inTeam()) return 0;
    const self = this.d.team.self().instanceId;
    const others = this.d.team
      .members()
      .filter((m) => m.instanceId !== self && m.revokedAt === null);
    const acked = others.map((m) => this.d.team.peer(m.instanceId)?.ackedSeq ?? 0);
    const minAck = acked.length === 0 ? this.d.replica.maxSeq() : Math.min(...acked);
    return this.d.replica.pruneTombstones(this.d.clock.now() - TOMBSTONE_TTL_MS, minAck);
  }

  /** After a revocation: hand the new key to every member that is on (FR-201.5). */
  async pushRekey(): Promise<void> {
    await this.syncAll(true);
  }
}
