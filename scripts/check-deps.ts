/**
 * check:deps (IMP-029, constitution §6.4): every runtime dependency in a workspace must be
 * justified in plan.md §4.1. Run with `node scripts/check-deps.ts` (Node 24 type stripping).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkspaceDeps {
  /** Short name used in the plan table: server, shared or web. */
  name: string;
  dependencies: string[];
}

/** Parses plan.md §4.1 into a map of workspace → allowed packages. */
export function parseAllowedDeps(planMarkdown: string): Map<string, Set<string>> {
  const start = planMarkdown.indexOf('### 4.1 Runtime dependencies');
  if (start < 0) throw new Error('plan.md has no "### 4.1 Runtime dependencies" section');
  const rest = planMarkdown.slice(start).split('\n').slice(1);
  const allowed = new Map<string, Set<string>>();
  for (const line of rest) {
    if (line.startsWith('#')) break;
    const cells = line.split('|').map((c) => c.trim());
    // ['', packages, workspaces, why, alternative, '']
    if (cells.length < 4 || cells[1] === 'Package' || /^-+$/.test(cells[1] ?? '')) continue;
    const pkgs = (cells[1] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const workspaces = (cells[2] ?? '')
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);
    for (const ws of workspaces) {
      const set = allowed.get(ws) ?? new Set<string>();
      for (const p of pkgs) set.add(p);
      allowed.set(ws, set);
    }
  }
  return allowed;
}

/** Returns human-readable violations; empty when everything is justified. */
export function findUnlistedDeps(planMarkdown: string, workspaces: WorkspaceDeps[]): string[] {
  const allowed = parseAllowedDeps(planMarkdown);
  const problems: string[] = [];
  for (const ws of workspaces) {
    const ok = allowed.get(ws.name) ?? new Set<string>();
    for (const dep of ws.dependencies) {
      if (dep.startsWith('@uniwake/')) continue;
      if (!ok.has(dep)) {
        problems.push(`${ws.name}: runtime dependency "${dep}" is not justified in plan.md §4.1`);
      }
    }
  }
  return problems;
}

const WORKSPACES: Record<string, string> = {
  root: '.',
  shared: 'packages/shared',
  server: 'apps/server',
  web: 'apps/web',
};

function readDeps(dir: string): string[] {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(pkg.dependencies ?? {});
}

if (import.meta.main) {
  const plan = readFileSync('specs/plan.md', 'utf8');
  const problems = findUnlistedDeps(
    plan,
    Object.entries(WORKSPACES).map(([name, dir]) => ({ name, dependencies: readDeps(dir) })),
  );
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ ${p}`);
    process.exit(1);
  }
  console.log('✔ all runtime dependencies are justified in plan.md §4.1');
}
