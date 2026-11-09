/**
 * "Ligar pelas vizinhas" (FR-701.3, ADR-063): the wake-up proxy idea of the big management suites
 * with this project's pull model. In a retry round the hub picks up to 3 awake lab PCs whose agent
 * checked in during the last 3 minutes — same room first, then the same /24 as the target's last
 * IP — and queues a request for each. The request travels in the PC's next signed check-in answer
 * (≤ 1 min); the agent broadcasts the magic packet in its own network, where routers and VLANs no
 * longer matter, and reports it back; the hub then logs it in the packet log with `via` = that PC.
 */
import { parseMac, type AgentRelayReport } from '@uniwake/shared';
import { sameSubnet } from '../../domain/network';
import type { Clock, Logger } from '../ports';
import type { SettingsService } from '../settings/settings-service';
import type { RelayTarget, WakeRelay } from './job-runner';
import type { JobsRepo } from './types';

/** An agent may relay when it checked in this recently (it checks in every minute). */
export const RELAY_PEER_SEEN_MS = 3 * 60_000;
/** A request not picked up by then is dropped (the next round makes a new one). */
export const RELAY_EXPIRY_MS = 2 * 60_000;
export const RELAY_PEERS_PER_TARGET = 3;
/** At most this many MACs in one answer (contract limit). */
export const RELAY_MAX_PER_ANSWER = 50;
/** The first agent version that relays (1.8.0 ships with hub 1.7.0). */
export const RELAY_MIN_AGENT = [1, 8, 0] as const;

export interface RelayPeer {
  deviceId: number;
  name: string;
  ip: string | null;
  roomId: number | null;
  agentVersion: string | null;
  seenAt: number;
}

export interface WakeRelayStore {
  /** Ready (not revoked) agents seen since `since`, with their last check-in IP. */
  peers(since: number): RelayPeer[];
  /** Inserts the requests (duplicates per job/round/target/peer ignored); returns how many. */
  insert(
    rows: {
      jobId: number;
      deviceId: number;
      relayDeviceId: number;
      mac: string;
      round: number;
      createdAt: number;
      expiresAt: number;
    }[],
  ): number;
  /** Undelivered, unexpired requests for this relay PC, oldest first. */
  due(relayDeviceId: number, now: number, limit: number): { id: number; mac: string }[];
  markDelivered(ids: readonly number[], at: number): void;
  /** The delivered request this report answers: same relay PC and MAC, delivered before `at`. */
  match(
    relayDeviceId: number,
    mac: string,
    at: number,
  ): { jobId: number; deviceId: number; round: number } | null;
  device(id: number): { name: string; ip: string | null } | null;
}

export interface WakeRelayDeps {
  store: WakeRelayStore;
  jobs: JobsRepo;
  settings: SettingsService;
  clock: Clock;
  logger?: Logger;
  transaction: <T>(fn: () => T) => T;
}

/** "1.8.0", "1.8.0-dev.3" ≥ 1.8.0; anything unparsable is too old. */
export function relayCapable(version: string | null): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i]! !== RELAY_MIN_AGENT[i]) return v[i]! > RELAY_MIN_AGENT[i]!;
  }
  return true;
}

/** Peers for one target: same room first, then same /24 as its last IP, freshest first. */
export function pickPeers(
  target: RelayTarget,
  peers: readonly RelayPeer[],
  max = RELAY_PEERS_PER_TARGET,
): RelayPeer[] {
  const others = peers
    .filter((p) => p.deviceId !== target.deviceId && relayCapable(p.agentVersion))
    .sort((a, b) => b.seenAt - a.seenAt);
  const sameRoom = others.filter((p) => target.roomId !== null && p.roomId === target.roomId);
  const sameNet = others.filter((p) => {
    if (sameRoom.includes(p) || !p.ip || !target.ip) return false;
    try {
      return sameSubnet(p.ip, target.ip, 24);
    } catch {
      return false;
    }
  });
  return [...sameRoom, ...sameNet].slice(0, max);
}

export class WakeRelayService implements WakeRelay {
  constructor(private readonly d: WakeRelayDeps) {}

  request(
    jobId: number,
    round: number,
    targets: readonly RelayTarget[],
  ): { requested: number; peers: string[] } {
    const now = this.d.clock.now();
    const peers = this.d.store.peers(now - RELAY_PEER_SEEN_MS);
    const names = new Set<string>();
    const rows: Parameters<WakeRelayStore['insert']>[0] = [];
    for (const t of targets) {
      for (const p of pickPeers(t, peers)) {
        names.add(p.name);
        rows.push({
          jobId,
          deviceId: t.deviceId,
          relayDeviceId: p.deviceId,
          mac: t.mac,
          round,
          createdAt: now,
          expiresAt: now + RELAY_EXPIRY_MS,
        });
      }
    }
    const requested = rows.length === 0 ? 0 : this.d.transaction(() => this.d.store.insert(rows));
    return { requested, peers: [...names] };
  }

  /** The `wake` part of this PC's check-in answer; marks the requests delivered. */
  forAgent(deviceId: number): { ports: number[]; macs: string[] } | undefined {
    const now = this.d.clock.now();
    const due = this.d.store.due(deviceId, now, RELAY_MAX_PER_ANSWER * 3);
    if (due.length === 0) return undefined;
    const macs = [...new Set(due.map((r) => r.mac))].slice(0, RELAY_MAX_PER_ANSWER);
    const ids = due.filter((r) => macs.includes(r.mac)).map((r) => r.id);
    this.d.transaction(() => this.d.store.markDelivered(ids, now));
    return { ports: this.d.settings.get('wake.ports').slice(0, 4), macs };
  }

  /** What this PC says it sent (health.relays): logged in the packet log of the right job. */
  onReported(deviceId: number, reports: readonly AgentRelayReport[]): void {
    if (reports.length === 0) return;
    const peer = this.d.store.device(deviceId);
    if (!peer) return;
    const port = this.d.settings.get('wake.ports')[0] ?? 9;
    for (const r of reports) {
      const parsed = parseMac(r.mac);
      if (!parsed.ok) continue;
      const mac = parsed.mac;
      const m = this.d.store.match(deviceId, mac, r.at);
      if (!m) continue;
      // A report re-sent after a lost answer must not be logged twice.
      if (this.d.jobs.hasRelayPacket?.(m.jobId, m.deviceId, peer.name, r.at)) continue;
      this.d.transaction(() =>
        this.d.jobs.logPackets([
          {
            jobId: m.jobId,
            deviceId: m.deviceId,
            mac,
            srcIp: peer.ip ?? 'desconhecido',
            dstIp: '255.255.255.255',
            port,
            repeat: 0,
            at: r.at,
            outcome: r.error === null && r.sent > 0 ? 'sent' : 'error',
            error:
              r.error === null && r.sent > 0 ? null : (r.error ?? 'nada enviado').slice(0, 200),
            round: m.round,
            via: peer.name,
          },
        ]),
      );
      if (r.error !== null || r.sent === 0) {
        this.d.logger?.warn(
          { jobId: m.jobId, relay: peer.name, mac, error: r.error },
          'a neighbour could not send the magic packet',
        );
      } else {
        this.d.logger?.info(
          { jobId: m.jobId, relay: peer.name, mac, sent: r.sent },
          'a neighbour sent the magic packet',
        );
      }
    }
  }
}
