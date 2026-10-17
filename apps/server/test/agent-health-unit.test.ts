/** v1.6.0 (FR-603.5, FR-604.2): the pure rules behind the notices and the device list marks. */
import { describe, expect, it } from 'vitest';
import type { AgentHealth } from '@uniwake/shared';
import {
  agentAlertOf,
  agentVersionOf,
  healthEvents,
  productFor,
} from '../src/application/power/agent-health';
import type { StoredHealth } from '../src/application/power/agent-service';

const NOW = 1_791_850_900_000;
const base: AgentHealth = { installLevel: 2, update: null, repairs: [], antivirus: null };
const stored = (h: Partial<StoredHealth> = {}): StoredHealth => ({
  installLevel: 2,
  update: null,
  repairs: [],
  antivirus: null,
  antivirusAt: null,
  alert: null,
  receivedAt: NOW,
  ...h,
});

describe('health events (FR-604.2)', () => {
  it('a repair or a detection counts once; an updated file is no event', () => {
    const repair = {
      at: NOW - 10,
      file: 'uniwake-agent.ps1' as const,
      reason: 'missing' as const,
      outcome: 'restored' as const,
    };
    expect(healthEvents(null, { ...base, repairs: [repair] })).toHaveLength(1);
    expect(healthEvents(stored({ repairs: [repair] }), { ...base, repairs: [repair] })).toEqual([]);
    const updated = {
      outcome: 'updated' as const,
      file: 'uniwake-aviso.ps1' as const,
      at: NOW,
      code: null,
      detail: null,
    };
    expect(healthEvents(null, { ...base, update: updated })).toEqual([]);
    const blocked = { ...updated, outcome: 'write_blocked' as const, code: 225 };
    expect(healthEvents(stored({ update: blocked }), { ...base, update: blocked })).toEqual([]);
  });

  it('names Defender for its detections and a third-party product for blocked writes', () => {
    const h = stored({
      antivirus: {
        products: [
          { name: 'Windows Defender', enabled: false, upToDate: true },
          { name: 'ESET Security', enabled: true, upToDate: true },
        ],
        detections: [],
      },
    });
    expect(productFor(h, 'detection')).toBe('Windows Defender');
    expect(productFor(h, 'update_blocked')).toBe('ESET Security');
    expect(productFor(null, 'update_blocked')).toBeNull();
  });
});

describe('device list mark (FR-603.5)', () => {
  const agent = { agentVersion: '1.7.0', lastCheckin: NOW - 60_000 };
  it('blocked while the last update was blocked or an alert came after the last check-in', () => {
    const blocked = {
      outcome: 'removed_after_write' as const,
      file: 'uniwake-agent.ps1' as const,
      at: NOW,
      code: null,
      detail: null,
    };
    expect(agentAlertOf(stored({ update: blocked }), agent, '1.7.0', NOW)).toBe('blocked');
    expect(
      agentAlertOf(stored({ alert: { file: 'uniwake-agent.ps1', at: NOW } }), agent, '1.7.0', NOW),
    ).toBe('blocked');
    // The agent checked in after the alert: it is back.
    expect(
      agentAlertOf(stored({ alert: { file: 'x', at: NOW - 120_000 } }), agent, '1.7.0', NOW),
    ).toBeNull();
  });

  it('outdated when the version differs from the shipped one; unknown shipped version → no mark', () => {
    expect(agentAlertOf(null, { ...agent, agentVersion: '1.6.0' }, '1.7.0', NOW)).toBe('outdated');
    expect(agentAlertOf(null, { ...agent, agentVersion: '1.6.0' }, null, NOW)).toBeNull();
  });

  it('reads the shipped version from the bundled script', () => {
    expect(agentVersionOf(Buffer.from("x\n$script:UwAgentVersion = '1.7.0'\n"))).toBe('1.7.0');
    expect(agentVersionOf(Buffer.from('# nada'))).toBeNull();
    expect(agentVersionOf(null)).toBeNull();
  });
});
