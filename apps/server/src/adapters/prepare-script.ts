/**
 * prepare-target.ps1 as shipped with this version (FR-007.3). Read once: the agent listener
 * serves these exact bytes and the panel's command pins their SHA-256 (AC-007-13). A new script
 * only arrives with an update, which installs a new version directory and restarts the service.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrepareScript } from '../application/enrollment/enrollment-service';

export class PrepareScriptFile implements PrepareScript {
  private cached: Buffer | null = null;

  constructor(private readonly path: string | null) {}

  bytes(): Buffer | null {
    if (this.cached || !this.path) return this.cached;
    try {
      this.cached = readFileSync(this.path);
    } catch {
      return null; // reported as PREPARE_SCRIPT_MISSING; retried on the next request
    }
    return this.cached;
  }
}

/** scripts\prepare-target.ps1 next to the bundle (installed, plan §9) or at the repo root (source). */
export function resolvePrepareScriptPath(bundleDir: string): string | null {
  const file = 'prepare-target.ps1';
  const candidates = [
    join(bundleDir, 'scripts', file),
    join(bundleDir, '..', '..', '..', 'scripts', file),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}
