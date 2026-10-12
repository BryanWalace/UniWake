/**
 * The hub side of the lab-PC agent (FR-301..303, ADR-043/044).
 * - Enrollment (M17-T01): a v1.3 preparation script receives the machine's token, the hub's public
 *   key and the hashes of the agent scripts it must download.
 * - Check-in (M17-T02): every minute the machine sends its reports and status and receives its
 *   orders, its agenda, the hub list and the script hashes. The HTTP layer signs the answer over the
 *   machine's nonce, so nothing in it can be forged or replayed.
 */
import {
  AGENT_SCRIPTS,
  CHECKIN_PER_IP_PER_MINUTE,
  CHECKIN_PER_TOKEN_PER_MINUTE,
  type AgentOrder,
  type AgentReport,
  type CheckinAnswer,
  type CheckinRequest,
  type EnrollAgentAnswer,
  type PowerPolicy,
} from '@uniwake/shared';
import { AppError } from '../errors';
import type { Clock } from '../ports';
import { KeyedLimiter } from '../rate-limit';
import type { SettingsService } from '../settings/settings-service';
import type { AgendaService } from './agenda-service';
import type { AgentIdentity, AgentTokensService } from './agent-tokens';
import type { HubKeyService } from './hub-key';

export interface AgentScript {
  bytes: Buffer;
  sha256: string;
}

export interface AgentScripts {
  get(name: (typeof AGENT_SCRIPTS)[number]): AgentScript | null;
}

/** An order waiting for the machine (FR-305); repeated in every answer until acknowledged. */
export interface PendingOrder extends PowerPolicy {
  uuid: string;
  action: 'shutdown' | 'restart';
}

/** What the last check-in said about the machine (machine-local, plan §15.3). */
export interface AgentSighting {
  seenAt: number;
  ip: string | null;
  bootTime: number | null;
  clockOffsetMs: number;
  userLoggedOn: boolean | null;
  sessionCount: number;
}

/** Status fields kept on the replicated `device_agents` row (changed only when they change). */
export interface AgentStatus {
  agentVersion: string;
  protocol: number;
  freezeProduct: string | null;
  freezeState: string;
  persistent: boolean;
  sleepAfterMinutes: number | null;
  wakeTimers: string;
  /** Last check-in rounded down to 30 minutes (ADR-048: little change-log churn). */
  seenCoarseAt: number;
}

export interface AgentStore {
  /** Stores a report once (its UUID is made by the machine); false when it was already known. */
  insertReport(deviceId: number, r: AgentReport, receivedAt: number): boolean;
  /** The order a report settles, if it belongs to this machine and is still open. */
  settleOrder(
    deviceId: number,
    orderUuid: string,
    state: 'executed' | 'cancelled' | 'failed' | 'expired',
    at: number,
    detail: string | null,
  ): void;
  ackOrders(deviceId: number, uuids: readonly string[], at: number, instance: string): void;
  expireOrders(now: number): void;
  pendingOrders(deviceId: number, now: number): PendingOrder[];
  /** Orders the machine received and that were cancelled before running (not yet expired). */
  cancelledDelivered(deviceId: number, now: number): string[];
  saveSighting(deviceId: number, s: AgentSighting): void;
  saveStatus(deviceId: number, s: AgentStatus): void;
}

export interface HubEntrySource {
  instanceId: string;
  epoch: number;
  /** `http://ip:port` this machine can use for the hub that answers, if known. */
  selfUrl: string | null;
  /** The other team hubs a machine may check in with (ADR-048), with their signing keys. */
  peers: { instanceId: string; url: string; keyId: string; publicKey: { n: string; e: string } }[];
}

export interface AgentServiceDeps {
  tokens: AgentTokensService;
  hubKey: HubKeyService;
  scripts: AgentScripts;
  store: AgentStore;
  agenda: AgendaService;
  settings: SettingsService;
  clock: Clock;
  transaction: <T>(fn: () => T) => T;
  /** Identity of this hub and how machines reach it (team hub list: M17-T06). */
  hub: (hostHeader: string | undefined) => HubEntrySource;
  /** Deterministic UUID for the cancel entry of an order (the same on every hub). */
  cancelId: (orderUuid: string) => string;
  /** The hub version: the scripts ship with it. */
  version: string;
}

const COARSE_MS = 30 * 60_000;

const SETTLE: Record<AgentReport['outcome'], 'executed' | 'cancelled' | 'failed'> = {
  done: 'executed',
  cancelled: 'cancelled',
  skipped: 'failed',
  failed: 'failed',
};

export class AgentService {
  private readonly perIp: KeyedLimiter;
  private readonly perDevice: KeyedLimiter;

  constructor(private readonly d: AgentServiceDeps) {
    this.perIp = new KeyedLimiter(d.clock, 60_000, () => CHECKIN_PER_IP_PER_MINUTE);
    this.perDevice = new KeyedLimiter(d.clock, 60_000, () => CHECKIN_PER_TOKEN_PER_MINUTE);
  }

  /** `{name: {version, sha256}}` for the signed answers; AGENT_SCRIPTS_MISSING if any is absent. */
  scriptRefs(): EnrollAgentAnswer['scripts'] {
    const ref = (name: (typeof AGENT_SCRIPTS)[number]) => {
      const s = this.d.scripts.get(name);
      if (!s) throw new AppError('AGENT_SCRIPTS_MISSING');
      return { version: this.d.version.slice(0, 32), sha256: s.sha256 };
    };
    return {
      'uniwake-agent.ps1': ref('uniwake-agent.ps1'),
      'uniwake-aviso.ps1': ref('uniwake-aviso.ps1'),
    };
  }

  script(name: string): AgentScript | null {
    return (AGENT_SCRIPTS as readonly string[]).includes(name)
      ? this.d.scripts.get(name as (typeof AGENT_SCRIPTS)[number])
      : null;
  }

  /**
   * The agent part of an enrollment answer (FR-301.1): a fresh token for the device (the previous
   * one stops working), the key `-HubKeyId` must match and the script hashes. Scripts are checked
   * first, so a hub without them issues no token.
   */
  async enrollAnswer(deviceId: number): Promise<EnrollAgentAnswer> {
    const scripts = this.scriptRefs();
    await this.d.hubKey.ensure();
    return {
      token: this.d.tokens.issue(deviceId),
      keyId: this.d.hubKey.keyId(),
      hubKey: this.d.hubKey.publicKey(),
      scripts,
    };
  }

  /** FR-302.3: 60 check-ins per minute per source IP, before the token or body is looked at. */
  allowFrom(ip: string): boolean {
    return this.perIp.hit(ip);
  }

  /** The machine behind a token, counted against its 6 check-ins per minute (FR-302.3). */
  identify(token: string): AgentIdentity {
    const who = this.d.tokens.authenticate(token);
    if (!who) throw new AppError('AGENT_TOKEN_INVALID');
    if (!this.perDevice.hit(String(who.deviceId))) throw new AppError('AGENT_RATE_LIMITED');
    return who;
  }

  /** One check-in (FR-302.1): stores what the machine sent, answers what it needs. */
  checkin(
    who: AgentIdentity,
    req: CheckinRequest,
    ctx: { ip: string | null; host: string | undefined },
  ): CheckinAnswer {
    const now = this.d.clock.now();
    const deviceId = who.deviceId;
    const hub = this.d.hub(ctx.host);
    const scripts = this.scriptRefs();
    const { ackReports, orders, newToken } = this.d.transaction(() => {
      // Receipts first: a 1-min order is often acknowledged and reported in the same check-in.
      this.d.store.ackOrders(deviceId, req.ackedOrders, now, hub.instanceId);
      const acked: string[] = [];
      for (const r of req.reports) {
        this.d.store.insertReport(deviceId, r, now);
        acked.push(r.uuid);
        if (r.order !== null) {
          const state = r.reason === 'expired' ? 'expired' : SETTLE[r.outcome];
          this.d.store.settleOrder(deviceId, r.order, state, r.executedAt ?? now, r.detail);
        }
      }
      this.d.store.expireOrders(now);
      this.d.store.saveSighting(deviceId, {
        seenAt: now,
        ip: ctx.ip,
        bootTime: req.bootTime,
        clockOffsetMs: now - req.clock,
        userLoggedOn: req.session.loggedOn,
        sessionCount: req.session.sessions,
      });
      this.d.store.saveStatus(deviceId, {
        agentVersion: req.agentVersion,
        protocol: req.protocol,
        freezeProduct: req.freeze.product,
        freezeState: req.freeze.state,
        persistent: req.freeze.persistent,
        sleepAfterMinutes: req.power.sleepAfterMinutes,
        wakeTimers: req.power.wakeTimers,
        seenCoarseAt: Math.floor(now / COARSE_MS) * COARSE_MS,
      });
      // Rotation uses what the machine just told us about freezing (ADR-043).
      const row = {
        ...who.row,
        freezeState: req.freeze.state,
        persistent: req.freeze.persistent,
      };
      const out: AgentOrder[] = [
        ...this.d.store.pendingOrders(deviceId, now),
        ...this.d.store.cancelledDelivered(deviceId, now).map((cancels) => ({
          uuid: this.d.cancelId(cancels),
          action: 'cancel' as const,
          cancels,
        })),
      ];
      return {
        ackReports: acked,
        orders: out,
        newToken: this.d.tokens.rotationDue(row) ? this.d.tokens.rotate(deviceId) : null,
      };
    });
    const agenda = this.d.agenda.forDevice(deviceId);
    if (!agenda) throw new AppError('AGENT_TOKEN_INVALID'); // device deleted meanwhile
    const selfKey = this.d.hubKey;
    return {
      protocol: 1,
      serverTime: now,
      orders,
      agenda,
      message: {
        warning: this.d.settings.get('power.warningMessage'),
        postpone: this.d.settings.get('power.postponeMessage'),
      },
      hubs: {
        epoch: hub.epoch,
        list: [
          ...(hub.selfUrl === null
            ? []
            : [
                {
                  instanceId: hub.instanceId,
                  urls: [hub.selfUrl],
                  keyId: selfKey.keyId(),
                  publicKey: selfKey.publicKey(),
                },
              ]),
          ...hub.peers.map((p) => ({
            instanceId: p.instanceId,
            urls: [p.url],
            keyId: p.keyId,
            publicKey: p.publicKey,
          })),
        ].slice(0, 16),
      },
      scripts,
      ackReports,
      newToken,
    };
  }
}
