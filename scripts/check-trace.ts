/**
 * check:trace (IMP-030): spec ACs ↔ tasks ↔ test titles.
 *  1. Every AC in spec.md is referenced by at least one task in tasks.md.
 *  2. Tasks reference only ACs that exist in spec.md.
 *  3. For every task marked [x], each of its non-[manual] ACs appears in a test title
 *     (Vitest `it/test/describe('AC-…')` or Pester `It/Describe 'AC-…'`).
 * Run with `node scripts/check-trace.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AC_RE = /AC-\d{3}-\d{2}[ab]?/g;

export interface SpecAc {
  id: string;
  manual: boolean;
}

/** ACs are list items like `- AC-001-01b [manual]: Given …`. */
export function parseSpecAcs(spec: string): Map<string, SpecAc> {
  const acs = new Map<string, SpecAc>();
  for (const line of spec.split('\n')) {
    const m = /^\s*-\s+(AC-\d{3}-\d{2}[ab]?)\b(.*)$/.exec(line);
    if (!m) continue;
    const id = m[1]!;
    const head = (m[2] ?? '').split(':')[0] ?? '';
    acs.set(id, { id, manual: /\[manual\]/i.test(head) });
  }
  return acs;
}

export interface TaskRow {
  id: string;
  done: boolean;
  acs: string[];
}

/** Task rows look like `| [x] M1-T09 | … |`. */
export function parseTasks(tasks: string): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const line of tasks.split('\n')) {
    const m = /^\|\s*\[( |x|~)\]\s*([A-Z0-9]+-[A-Z]?\d+[A-Z0-9-]*)\s*\|/.exec(line);
    if (!m) continue;
    rows.push({ id: m[2]!, done: m[1] === 'x', acs: [...new Set(line.match(AC_RE) ?? [])] });
  }
  return rows;
}

/**
 * AC IDs appearing in test titles of one test file's source. The title may start on the line
 * after `it(` because Prettier wraps long calls (R-M1-07).
 */
const TITLE_RE =
  /\b(?:it|test|describe|It|Describe|Context)\b\s*\(?\s*(['"`])((?:(?!\1)[^\n])*)\1/g;

export function acsInTestTitles(source: string): Set<string> {
  const found = new Set<string>();
  for (const m of source.matchAll(TITLE_RE)) {
    for (const id of m[2]?.match(AC_RE) ?? []) found.add(id);
  }
  return found;
}

export interface TraceReport {
  errors: string[];
  testedAcs: number;
  totalAcs: number;
}

export function checkTrace(spec: string, tasks: string, testSources: string[]): TraceReport {
  const specAcs = parseSpecAcs(spec);
  const rows = parseTasks(tasks);
  const tested = new Set<string>();
  for (const src of testSources) for (const id of acsInTestTitles(src)) tested.add(id);

  const errors: string[] = [];
  const referenced = new Set(rows.flatMap((r) => r.acs));
  for (const id of specAcs.keys()) {
    if (!referenced.has(id)) errors.push(`${id} is not referenced by any task in tasks.md`);
  }
  for (const r of rows) {
    for (const id of r.acs) {
      if (!specAcs.has(id)) errors.push(`${r.id} references ${id}, which is not in spec.md`);
      else if (r.done && !specAcs.get(id)!.manual && !tested.has(id)) {
        errors.push(`${r.id} is done but ${id} has no test whose title contains "${id}"`);
      }
    }
  }
  const automated = [...specAcs.values()].filter((a) => !a.manual);
  return {
    errors,
    testedAcs: automated.filter((a) => tested.has(a.id)).length,
    totalAcs: automated.length,
  };
}

function collectTestFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectTestFiles(p, out);
    else if (/\.test\.tsx?$|\.Tests\.ps1$/.test(name)) out.push(p);
  }
  return out;
}

if (import.meta.main) {
  const files = ['apps', 'packages', 'scripts', 'test'].flatMap((d) => {
    try {
      return collectTestFiles(d);
    } catch {
      return [];
    }
  });
  const report = checkTrace(
    readFileSync('specs/spec.md', 'utf8'),
    readFileSync('specs/tasks.md', 'utf8'),
    files.map((f) => readFileSync(f, 'utf8')),
  );
  for (const e of report.errors) console.error(`✖ ${e}`);
  console.log(`ACs with tests: ${report.testedAcs}/${report.totalAcs} (automated)`);
  if (report.errors.length > 0) process.exit(1);
  console.log('✔ traceability OK');
}
