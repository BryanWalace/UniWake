/**
 * The lab-PC agent scripts shipped with this version (ADR-042/044): served by
 * `GET /agent/v1/scripts/:name`, their SHA-256 sent in signed answers. Read once; a new script only
 * arrives with an update (new version directory, service restart).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_SCRIPTS } from '@uniwake/shared';
import type { AgentScript, AgentScripts } from '../application/power/agent-service';

export class AgentScriptFiles implements AgentScripts {
  private readonly cache = new Map<string, AgentScript>();

  constructor(private readonly dir: string | null) {}

  get(name: (typeof AGENT_SCRIPTS)[number]): AgentScript | null {
    const hit = this.cache.get(name);
    if (hit || !this.dir) return hit ?? null;
    try {
      const bytes = readFileSync(join(this.dir, name));
      const script = { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
      this.cache.set(name, script);
      return script;
    } catch {
      return null; // AGENT_SCRIPTS_MISSING; retried on the next request
    }
  }
}

/** scripts\agent next to the bundle (installed, plan §9) or at the repo root (source). */
export function resolveAgentScriptsDir(bundleDir: string): string | null {
  const candidates = [
    join(bundleDir, 'scripts', 'agent'),
    join(bundleDir, '..', '..', '..', 'scripts', 'agent'),
  ];
  return candidates.find((c) => existsSync(join(c, AGENT_SCRIPTS[0]))) ?? null;
}
