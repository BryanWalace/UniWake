/**
 * The hub side of the lab-PC agent (FR-301..303, ADR-043/044). M17-T01: what a v1.3 preparation
 * script receives at enrollment — the machine's token, the hub's public key and the hashes of the
 * agent scripts it must download — signed over the script's nonce by the HTTP layer.
 */
import { AGENT_SCRIPTS, type EnrollAgentAnswer } from '@uniwake/shared';
import { AppError } from '../errors';
import type { AgentTokensService } from './agent-tokens';
import type { HubKeyService } from './hub-key';

export interface AgentScript {
  bytes: Buffer;
  sha256: string;
}

export interface AgentScripts {
  get(name: (typeof AGENT_SCRIPTS)[number]): AgentScript | null;
}

export interface AgentServiceDeps {
  tokens: AgentTokensService;
  hubKey: HubKeyService;
  scripts: AgentScripts;
  /** The hub version: the scripts ship with it. */
  version: string;
}

export class AgentService {
  constructor(private readonly d: AgentServiceDeps) {}

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
}
