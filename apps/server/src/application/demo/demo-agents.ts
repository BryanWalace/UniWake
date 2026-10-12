/**
 * Simulated lab-PC agents for demo mode (FR-310, constitution §2.5). Nothing leaves the process:
 * every "check-in" is a direct call to the same store the real check-in uses, and a "shutdown" only
 * switches the machine off in the simulated network. Behaviours are chosen by name, so the seeded
 * demo shows every case and E2E specs can pick one:
 * - "ADIA" (or LAB2-PC03): postpones twice before shutting down;
 * - "V12" (or LAB3-PC05, LAB3-PC06): prepared with v1.2, no agent ("Precisa do novo preparo");
 * - "CONGEL" (or BIB-PC02): frozen, stops checking in and becomes "Desligamento remoto perdido";
 * - every other machine: ready, runs orders and agenda items.
 * Demo time is short: a warning lasts 3 s and each postpone 2 s.
 */
import { randomUUID } from 'node:crypto';
import type { AgentReport, Agenda, PowerPolicy } from '@uniwake/shared';
import type { EventsBus } from '../events-bus';
import type { Clock, TimerHandle } from '../ports';
import type { AgentSighting, AgentStatus, PendingOrder } from '../power/agent-service';

export type DemoBehaviour = 'ready' | 'postpone' | 'v12' | 'frozen';

const POSTPONERS = new Set(['LAB2-PC03']);
const V12 = new Set(['LAB3-PC05', 'LAB3-PC06']);
const FROZEN = new Set(['BIB-PC02']);

export function demoBehaviour(name: string): DemoBehaviour {
  const n = name.toUpperCase();
  if (V12.has(n) || n.includes('V12')) return 'v12';
  if (FROZEN.has(n) || n.includes('CONGEL')) return 'frozen';
  if (POSTPONERS.has(n) || n.includes('ADIA')) return 'postpone';
  return 'ready';
}

export interface DemoAgentStore {
  devices(): { id: number; name: string; mac: string }[];
  hasAgent(deviceId: number): boolean;
  /** A prepared agent (random token nobody holds). */
  issue(deviceId: number, now: number): void;
  pendingOrders(deviceId: number, now: number): PendingOrder[];
  ackOrders(deviceId: number, uuids: readonly string[], at: number, instance: string): void;
  orderState(uuid: string): string | null;
  jobOf(orderUuid: string): number | null;
  insertReport(deviceId: number, r: AgentReport, receivedAt: number): boolean;
  settleOrder(
    deviceId: number,
    orderUuid: string,
    state: 'executed' | 'cancelled' | 'failed' | 'expired',
    at: number,
    detail: string | null,
  ): void;
  saveSighting(deviceId: number, s: AgentSighting): void;
  saveStatus(deviceId: number, s: AgentStatus): void;
}

export interface DemoAgentsDeps {
  store: DemoAgentStore;
  agenda: (deviceId: number) => Agenda | null;
  setPower: (mac: string, on: boolean) => void;
  events: EventsBus;
  clock: Clock;
  instanceId: () => string;
  tickMs?: number;
}

const WARNING_MS = 3000;
const POSTPONE_MS = 2000;

interface Running {
  deviceId: number;
  mac: string;
  action: 'shutdown' | 'restart';
  at: number;
  postpones: number;
}

export class DemoAgentsService {
  private timer: TimerHandle | null = null;
  private lastTick: number;
  private readonly running = new Map<string, Running>();
  private readonly doneOccurrences = new Set<string>();
  private readonly frozenMarked = new Set<number>();

  constructor(private readonly d: DemoAgentsDeps) {
    this.lastTick = d.clock.now();
  }

  start(): void {
    const loop = () => {
      try {
        this.tick();
      } finally {
        this.timer = this.d.clock.setTimeout(loop, this.d.tickMs ?? 2000);
      }
    };
    this.timer = this.d.clock.setTimeout(loop, 500);
  }

  stop(): void {
    if (this.timer) this.d.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** One round of simulated check-ins (public for tests). */
  tick(): void {
    const now = this.d.clock.now();
    for (const dev of this.d.store.devices()) {
      const kind = demoBehaviour(dev.name);
      if (kind === 'v12') continue; // never prepared with v1.3
      if (!this.d.store.hasAgent(dev.id)) this.d.store.issue(dev.id, now);
      if (kind === 'frozen') {
        this.freeze(dev, now);
        continue;
      }
      this.d.store.saveSighting(dev.id, {
        seenAt: now,
        ip: null,
        bootTime: null,
        clockOffsetMs: 0,
        userLoggedOn: dev.id % 3 === 0,
        sessionCount: dev.id % 3 === 0 ? 1 : 0,
      });
      this.d.store.saveStatus(dev.id, {
        agentVersion: '1.3.0-demo',
        protocol: 1,
        freezeProduct: null,
        freezeState: 'none',
        persistent: false,
        sleepAfterMinutes: 30,
        wakeTimers: 'enabled',
        seenCoarseAt: now - (now % 1_800_000),
      });
      this.receiveOrders(dev, kind, now);
      this.runAgenda(dev, kind, now);
    }
    this.finishDue(now);
    this.lastTick = now;
  }

  /** A frozen PC checked in once, long ago, and never again (FR-308.3). */
  private freeze(dev: { id: number; mac: string }, now: number) {
    if (this.frozenMarked.has(dev.id)) return;
    this.frozenMarked.add(dev.id);
    this.d.store.saveSighting(dev.id, {
      seenAt: now - 2 * 3_600_000,
      ip: null,
      bootTime: null,
      clockOffsetMs: 0,
      userLoggedOn: false,
      sessionCount: 0,
    });
    this.d.store.saveStatus(dev.id, {
      agentVersion: '1.3.0-demo',
      protocol: 1,
      freezeProduct: 'deep_freeze',
      freezeState: 'frozen',
      persistent: false,
      sleepAfterMinutes: 0,
      wakeTimers: 'enabled',
      seenCoarseAt: now - 2 * 3_600_000,
    });
    this.d.setPower(dev.mac, true); // on, answering ping, silent → "perdido" after 15 min
  }

  private receiveOrders(dev: { id: number; mac: string }, kind: DemoBehaviour, now: number) {
    const orders = this.d.store.pendingOrders(dev.id, now);
    if (orders.length === 0) return;
    this.d.store.ackOrders(
      dev.id,
      orders.map((o) => o.uuid),
      now,
      this.d.instanceId(),
    );
    for (const o of orders) {
      const postpones = this.postponesFor(kind, o);
      this.running.set(o.uuid, {
        deviceId: dev.id,
        mac: dev.mac,
        action: o.action,
        at: now + WARNING_MS + postpones * POSTPONE_MS,
        postpones,
      });
      this.notify(o.uuid);
    }
  }

  private postponesFor(kind: DemoBehaviour, p: PowerPolicy): number {
    return kind === 'postpone' && p.allowPostpone ? p.postponeMax : 0;
  }

  /** Agenda items whose time came since the last round shut the machine down (FR-303). */
  private runAgenda(dev: { id: number; mac: string }, kind: DemoBehaviour, now: number) {
    const agenda = this.d.agenda(dev.id);
    for (const item of agenda?.items ?? []) {
      const key = `${item.occurrence}:${dev.id}`;
      if (item.at <= this.lastTick || item.at > now || this.doneOccurrences.has(key)) continue;
      this.doneOccurrences.add(key);
      const postpones = this.postponesFor(kind, item);
      this.d.store.insertReport(
        dev.id,
        this.report(item.occurrence, null, 'shutdown', item.at, now, postpones),
        now,
      );
      this.d.setPower(dev.mac, false);
    }
  }

  private finishDue(now: number) {
    for (const [uuid, r] of [...this.running]) {
      if (this.d.store.orderState(uuid) === 'cancelled') {
        this.running.delete(uuid);
        continue;
      }
      if (now < r.at) continue;
      this.running.delete(uuid);
      this.d.store.insertReport(
        r.deviceId,
        this.report(null, uuid, r.action, null, now, r.postpones),
        now,
      );
      this.d.store.settleOrder(r.deviceId, uuid, 'executed', now, null);
      this.d.setPower(r.mac, false);
      if (r.action === 'restart') {
        this.d.clock.setTimeout(() => this.d.setPower(r.mac, true), 5000);
      }
      this.notify(uuid);
    }
  }

  private report(
    occurrence: string | null,
    order: string | null,
    action: 'shutdown' | 'restart',
    plannedAt: number | null,
    now: number,
    postpones: number,
  ): AgentReport {
    return {
      uuid: randomUUID(),
      occurrence,
      order,
      action,
      outcome: 'done',
      reason: null,
      plannedAt,
      executedAt: now,
      postpones,
      userLoggedOn: false,
      sessions: 0,
      wasAsleep: false,
      lateMinutes: null,
      nativeWarning: false,
      freezeState: 'none',
      detail: null,
    };
  }

  private notify(orderUuid: string) {
    const jobId = this.d.store.jobOf(orderUuid);
    if (jobId !== null) this.d.events.publish({ type: 'power.job', jobId });
  }
}
