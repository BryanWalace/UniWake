/**
 * Monitoring sweeps (FR-004.1–.3). Every `monitor.intervalSeconds`, probe each enabled device
 * (hostname re-resolved with a TTL cache, IP drift recorded), apply the status state machine and
 * write the whole sweep in one transaction (plan §5.1). Status changes are published as events.
 */
import type { DeviceStatus } from '@uniwake/shared';
import { nextStatus, type ProbeOutcome, type StatusState } from '../../domain/status';
import type { EventsBus } from '../events-bus';
import type { Clock, DnsResolver, Logger, Prober, TimerHandle } from '../ports';
import type { SettingsService } from '../settings/settings-service';

export interface ProbeTarget {
  deviceId: number;
  ip: string | null;
  hostname: string | null;
  /** Disabled devices are not probed and read `desconhecido` (FR-004.1). */
  enabled: boolean;
  state: StatusState;
}

export interface StatusUpdate {
  deviceId: number;
  state: StatusState;
}

export interface DeviceEvent {
  deviceId: number;
  at: number;
  type: 'status' | 'ip_changed';
  data: Record<string, unknown>;
}

export interface MonitorRepo {
  /** Every device, or only the given ones. */
  targets(deviceIds?: readonly number[]): ProbeTarget[];
  saveStates(updates: readonly StatusUpdate[]): void;
  insertEvents(events: readonly DeviceEvent[]): void;
  updateIp(deviceId: number, ip: string, now: number): void;
  /** At hub start nothing is known (AC-004-11); returns the devices whose status was cleared. */
  resetAllUnknown(): { deviceId: number; from: DeviceStatus; lastProbeAt: number | null }[];
}

export interface SweepReport {
  startedAt: number;
  durationMs: number;
  probed: number;
  online: number;
  offline: number;
  unknown: number;
  changed: number;
}

export interface MonitorDeps {
  repo: MonitorRepo;
  prober: Prober;
  dns: DnsResolver;
  settings: SettingsService;
  clock: Clock;
  events: EventsBus;
  logger: Logger;
  transaction: <T>(fn: () => T) => T;
  /** Drops queued sweep probes so stop() returns quickly (the probe queue's low priority). */
  cancelProbes?: () => void;
}

/** Hostname lookups per sweep run at most this many at a time (be kind to the DNS server). */
export const DNS_CONCURRENCY = 32;

async function forEachLimit<T>(items: readonly T[], limit: number, fn: (t: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export class MonitorService {
  private timer: TimerHandle | null = null;
  private current: Promise<SweepReport> | null = null;
  private stopped = true;
  /** Set by stop() while a sweep runs: the sweep finishes without writing. */
  private aborting = false;
  private readonly dnsCache = new Map<string, { ip: string | null; at: number }>();
  /**
   * Positive verification probes, so a sweep running meanwhile does not undo them. Ordered by a
   * counter, not the wall clock, so a clock jump cannot lose one (M4-F4).
   */
  private readonly aliveSeq = new Map<number, number>();
  private seq = 0;
  lastSweep: SweepReport | null = null;

  constructor(private readonly d: MonitorDeps) {}

  /** Resets statuses (AC-004-11) and starts the sweep loop. */
  start(): void {
    if (!this.stopped) return; // already running (M4-F3)
    const now = this.d.clock.now();
    const cleared = this.d.transaction(() => {
      const rows = this.d.repo.resetAllUnknown();
      this.d.repo.insertEvents(
        rows.map(({ deviceId, from, lastProbeAt }) => ({
          deviceId,
          // The status was only known until the last probe: dating the change there keeps hub
          // downtime (or a crash) out of the uptime figures (FR-004.6).
          at: Math.min(now, lastProbeAt ?? now),
          type: 'status' as const,
          data: { from, to: 'desconhecido', reason: 'hub_start' },
        })),
      );
      return rows;
    });
    if (cleared.length > 0) this.d.events.publish({ type: 'counters' });
    this.stopped = false;
    this.schedule(0);
  }

  /** Stops the loop and waits for a sweep in progress, so the database can close safely. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.current) {
      // M4-F2: a 500-device sweep can take many seconds; drop its queued probes and its write.
      this.aborting = true;
      this.d.cancelProbes?.();
      await this.current.catch(() => undefined);
    }
  }

  private schedule(delayMs: number) {
    if (this.stopped) return;
    this.timer = this.d.clock.setTimeout(() => {
      void this.sweep()
        .catch((e: unknown) => this.d.logger.error({ err: e }, 'monitoring sweep failed'))
        .finally(() => this.schedule(this.d.settings.get('monitor.intervalSeconds') * 1000));
    }, delayMs);
  }

  private async resolve(hostname: string): Promise<string | null> {
    const ttl = this.d.settings.get('monitor.dnsCacheMinutes') * 60_000;
    const key = hostname.toLowerCase();
    const cached = this.dnsCache.get(key);
    const now = this.d.clock.now();
    const age = cached ? now - cached.at : -1;
    // A negative age means the clock went back: treat the entry as expired (M4-F4).
    if (cached && age >= 0 && age < ttl) return cached.ip;
    const ip = (await this.d.dns.resolve4(hostname).catch(() => []))[0] ?? null;
    this.dnsCache.set(key, { ip, at: now });
    if (this.dnsCache.size > 10_000) this.dnsCache.clear();
    return ip;
  }

  /**
   * Wake verification saw these devices answer: they are online now (FR-004.1 "positive probe in
   * the latest sweep or verification"), without waiting for the next sweep.
   */
  recordAlive(deviceIds: readonly number[]): void {
    if (deviceIds.length === 0) return;
    const now = this.d.clock.now();
    const mark = ++this.seq;
    for (const id of deviceIds) this.aliveSeq.set(id, mark);
    const offlineAfter = this.d.settings.get('monitor.offlineAfter');
    const changes: { t: ProbeTarget; next: StatusState }[] = [];
    this.d.transaction(() => {
      const targets = this.d.repo.targets(deviceIds).filter((t) => t.enabled);
      const updates: StatusUpdate[] = [];
      for (const t of targets) {
        const { next, changed } = nextStatus(
          t.state,
          { kind: 'alive', latencyMs: t.state.latencyMs },
          now,
          offlineAfter,
        );
        updates.push({ deviceId: t.deviceId, state: next });
        if (changed) changes.push({ t, next });
      }
      this.d.repo.saveStates(updates);
      this.d.repo.insertEvents(
        changes.map(({ t, next }) => ({
          deviceId: t.deviceId,
          at: now,
          type: 'status' as const,
          data: { from: t.state.status, to: next.status, via: 'verification' },
        })),
      );
    });
    for (const { t, next } of changes) {
      this.d.events.publish({
        type: 'device.status',
        deviceId: t.deviceId,
        status: next.status,
        latencyMs: next.latencyMs,
        lastSeenAt: next.lastSeenAt,
      });
    }
    if (changes.length > 0) this.d.events.publish({ type: 'counters' });
  }

  /** One full sweep (also used directly by tests and the health page). */
  async sweep(): Promise<SweepReport> {
    if (this.current) return this.current;
    this.current = this.doSweep();
    try {
      return await this.current;
    } finally {
      this.current = null;
      this.aborting = false;
    }
  }

  private async doSweep(): Promise<SweepReport> {
    const startedAt = this.d.clock.now();
    const seqAtStart = this.seq;
    const s = this.d.settings;
    const targets = this.d.repo.targets();

    // 1. Addresses: hostname first (DHCP may have moved the device), stored IP as fallback.
    const drift: { deviceId: number; from: string | null; to: string }[] = [];
    const addressOf = new Map<number, string | null>();
    await forEachLimit(
      targets.filter((t) => t.enabled),
      DNS_CONCURRENCY,
      async (t) => {
        let address = t.ip;
        if (t.hostname) {
          const resolved = await this.resolve(t.hostname);
          if (resolved) {
            if (resolved !== t.ip) drift.push({ deviceId: t.deviceId, from: t.ip, to: resolved });
            address = resolved;
          }
        }
        addressOf.set(t.deviceId, address);
      },
    );

    // 2. Probe every distinct address once.
    const addresses = [...new Set([...addressOf.values()].filter((a): a is string => a !== null))];
    const results = await this.d.prober.probe(addresses, {
      icmpTimeoutMs: s.get('monitor.icmpTimeoutMs'),
      tcpPorts: s.get('monitor.tcpPorts'),
      tcpTimeoutMs: s.get('monitor.tcpTimeoutMs'),
    });
    if (this.aborting) {
      return { startedAt, durationMs: 0, probed: 0, online: 0, offline: 0, unknown: 0, changed: 0 };
    }

    // 3. State machine.
    const now = this.d.clock.now();
    const offlineAfter = s.get('monitor.offlineAfter');
    const updates: StatusUpdate[] = [];
    const events: (DeviceEvent & { latencyMs: number | null; lastSeenAt: number | null })[] = [];
    const counts: Record<DeviceStatus, number> = { online: 0, offline: 0, desconhecido: 0 };
    for (const t of targets) {
      if (!t.enabled && t.state.status === 'desconhecido') {
        counts.desconhecido++;
        continue;
      }
      const address = addressOf.get(t.deviceId) ?? null;
      const r = address ? results.get(address) : undefined;
      const seenByVerification = (this.aliveSeq.get(t.deviceId) ?? 0) > seqAtStart;
      const outcome: ProbeOutcome = r?.alive
        ? { kind: 'alive', latencyMs: r.latencyMs }
        : seenByVerification
          ? { kind: 'alive', latencyMs: t.state.latencyMs }
          : address === null
            ? { kind: 'no_address' }
            : { kind: 'dead' };
      const { next, changed } = nextStatus(t.state, outcome, now, offlineAfter);
      updates.push({ deviceId: t.deviceId, state: next });
      counts[next.status]++;
      if (changed) {
        events.push({
          deviceId: t.deviceId,
          at: now,
          type: 'status',
          data: { from: t.state.status, to: next.status, address, via: r?.via ?? null },
          latencyMs: next.latencyMs,
          lastSeenAt: next.lastSeenAt,
        });
      }
    }

    // 4. One transaction for the whole sweep.
    this.d.transaction(() => {
      for (const x of drift) this.d.repo.updateIp(x.deviceId, x.to, now);
      this.d.repo.saveStates(updates);
      this.d.repo.insertEvents([
        ...drift.map((x) => ({
          deviceId: x.deviceId,
          at: now,
          type: 'ip_changed' as const,
          data: { from: x.from, to: x.to },
        })),
        ...events.map(({ latencyMs: _l, lastSeenAt: _s, ...e }) => e),
      ]);
    });

    for (const e of events) {
      this.d.events.publish({
        type: 'device.status',
        deviceId: e.deviceId,
        status: String(e.data.to),
        latencyMs: e.latencyMs,
        lastSeenAt: e.lastSeenAt,
      });
    }
    if (events.length > 0) this.d.events.publish({ type: 'counters' });

    const report: SweepReport = {
      startedAt,
      durationMs: this.d.clock.now() - startedAt,
      probed: addresses.length,
      online: counts.online,
      offline: counts.offline,
      unknown: counts.desconhecido,
      changed: events.length,
    };
    this.lastSweep = report;
    for (const [id, mark] of this.aliveSeq) if (mark <= seqAtStart) this.aliveSeq.delete(id);
    if (report.durationMs > 30_000)
      this.d.logger.warn({ ...report }, 'sweep slower than the 30 s target (NFR-01)');
    return report;
  }
}
