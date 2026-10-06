/**
 * Reads the IPv4 neighbor (ARP) cache for discovery (FR-101): the bundled `get-neighbors.ps1`
 * (Get-NetNeighbor as JSON), else `arp.exe -a`. Read-only; argument arrays and System32 paths
 * (plan §9.1).
 */
import { win32 } from 'node:path';
import type { ProcessRunner } from '../application/ports';
import {
  dedupeNeighbors,
  type Neighbor,
  parseArp,
  parseNetNeighborJson,
} from '../domain/neighbors';

export class WindowsNeighborCache {
  private readonly sys: string;

  constructor(
    private readonly runner: ProcessRunner,
    /** helper\get-neighbors.ps1; null = arp.exe only. */
    private readonly script: string | null,
    systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
  ) {
    this.sys = win32.join(systemRoot, 'System32');
  }

  async read(): Promise<Neighbor[]> {
    if (this.script) {
      try {
        const r = await this.runner.run(
          win32.join(this.sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script],
          { timeoutMs: 20_000 },
        );
        if (r.exitCode === 0) return dedupeNeighbors(parseNetNeighborJson(r.stdout));
      } catch {
        // Fall back to arp.exe below.
      }
    }
    const r = await this.runner.run(win32.join(this.sys, 'arp.exe'), ['-a'], { timeoutMs: 20_000 });
    return dedupeNeighbors(parseArp(r.stdout));
  }
}
