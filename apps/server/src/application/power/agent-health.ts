/**
 * What a lab PC's health means for the panel (FR-603.5, FR-604.2, ADR-059/060): the events worth a
 * dashboard notice (a blocked or removed update, a repair, an antivirus detection, the repair task's
 * alert), the short mark of the device list, and the agent version this hub ships. Pure.
 */
import type { AgentHealth, AgentHealthView } from '@uniwake/shared';
import type { StoredHealth } from './agent-service';

const DAY = 86_400_000;

export type HealthEvent =
  | { kind: 'update_blocked'; file: string; at: number; outcome: string; code: number | null }
  | {
      kind: 'repair';
      file: string;
      at: number;
      outcome: 'restored' | 'not_restored';
      reason: string;
    }
  | { kind: 'detection'; file: string; at: number; threat: string; action: string | null }
  | { kind: 'agent_missing'; file: string; at: number };

const BLOCKED = new Set(['write_blocked', 'removed_after_write']);

/** Events in `now` that `before` did not have (each one creates or extends the notice once). */
export function healthEvents(before: StoredHealth | null, now: AgentHealth): HealthEvent[] {
  const out: HealthEvent[] = [];
  const u = now.update;
  if (u && BLOCKED.has(u.outcome) && !(before?.update && before.update.at === u.at)) {
    out.push({ kind: 'update_blocked', file: u.file, at: u.at, outcome: u.outcome, code: u.code });
  }
  const lastRepair = Math.max(0, ...(before?.repairs ?? []).map((r) => r.at));
  for (const r of now.repairs) {
    if (r.at > lastRepair) {
      out.push({ kind: 'repair', file: r.file, at: r.at, outcome: r.outcome, reason: r.reason });
    }
  }
  if (now.antivirus) {
    const seen = new Set(
      (before?.antivirus?.detections ?? []).map((d) => `${d.at}:${d.file}:${d.threat}`),
    );
    for (const d of now.antivirus.detections) {
      if (!seen.has(`${d.at}:${d.file}:${d.threat}`)) {
        out.push({ kind: 'detection', file: d.file, at: d.at, threat: d.threat, action: d.action });
      }
    }
  }
  return out;
}

/**
 * The antivirus product to name in a message: Defender for its own detections, else an enabled
 * third-party product, else any product, else null.
 */
export function productFor(health: StoredHealth | null, kind: HealthEvent['kind']): string | null {
  const products = health?.antivirus?.products ?? [];
  const defender = products.find((p) => /defender/i.test(p.name));
  if (kind === 'detection') return defender?.name ?? 'Microsoft Defender';
  const other = products.find((p) => !/defender/i.test(p.name) && p.enabled !== false);
  return other?.name ?? defender?.name ?? products[0]?.name ?? null;
}

/**
 * The device list mark (FR-603.5): `blocked` while the last update attempt was blocked/removed, an
 * alert came after the last check-in, or a detection/repair happened in the last 24 h; `outdated`
 * when the agent's version differs from the one this hub ships.
 */
export function agentAlertOf(
  health: StoredHealth | null,
  agent: { agentVersion: string | null; lastCheckin: number | null },
  latestVersion: string | null,
  now: number,
): 'blocked' | 'outdated' | null {
  if (health) {
    if (health.update && BLOCKED.has(health.update.outcome)) return 'blocked';
    if (health.alert && (agent.lastCheckin === null || health.alert.at > agent.lastCheckin)) {
      return 'blocked';
    }
    const recent = (at: number) => now - at < DAY;
    if (health.repairs.some((r) => recent(r.at))) return 'blocked';
    if (health.antivirus?.detections.some((d) => recent(d.at))) return 'blocked';
  }
  if (latestVersion && agent.agentVersion && agent.agentVersion !== latestVersion) {
    return 'outdated';
  }
  return null;
}

export function healthView(h: StoredHealth): AgentHealthView {
  return {
    installLevel: h.installLevel,
    update: h.update,
    repairs: h.repairs,
    antivirus: h.antivirus && h.antivirusAt !== null ? { ...h.antivirus, at: h.antivirusAt } : null,
    alert: h.alert,
    power: h.power,
    receivedAt: h.receivedAt,
  };
}

/** `$script:UwAgentVersion = '1.7.0'` in the bundled agent script, or null. */
export function agentVersionOf(script: Uint8Array | null | undefined): string | null {
  if (!script) return null;
  const m = /\$script:UwAgentVersion\s*=\s*'([0-9A-Za-z.+-]{1,32})'/.exec(
    Buffer.from(script).toString('utf8'),
  );
  return m ? m[1]! : null;
}
