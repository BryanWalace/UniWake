/**
 * check:docs (constitution §9 item 9, owner 2026-10-18): the public documents exist and keep up with
 * the versions. Every `npm run verify` checks them against the newest `specs/releases/vX.Y.Z.md`;
 * the release workflow passes the tag (`node scripts/check-docs.ts v1.7.0`) so a version is never
 * published with an old roadmap, changelog or security table. Node 24 type stripping.
 */
import { readdirSync, readFileSync } from 'node:fs';

export const REQUIRED_DOCS = [
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  '.github/pull_request_template.md',
] as const;

/** Documents the README must link to, so a reader finds them from the front page. */
const README_LINKS = [
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
];

export type Docs = Partial<Record<(typeof REQUIRED_DOCS)[number], string>>;

/** `v1.6.0` / `v1.6.0-rc.1` / `1.6.0` → `[1, 6, 0]`; null when it is not a version. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** The newest version among the release-notes file names (`v1.6.0.md`). */
export function newestRelease(fileNames: readonly string[]): string | null {
  const versions = fileNames
    .map((f) => parseVersion(f.replace(/\.md$/, '')))
    .filter((v): v is [number, number, number] => v !== null)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const last = versions.at(-1);
  return last ? last.join('.') : null;
}

/** The lines of a `## Heading` section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return '';
  const level = heading.indexOf(' ');
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^(#+) /.exec(line);
    if (m && m[1]!.length <= level) break;
    out.push(line);
  }
  return out.join('\n');
}

/** Everything wrong with the documents for `version` (`X.Y.Z`); empty when all is fine. */
export function findDocProblems(docs: Docs, version: string | null): string[] {
  const problems: string[] = [];
  for (const name of REQUIRED_DOCS) {
    if (!docs[name]?.trim()) problems.push(`${name} is missing or empty`);
  }
  const license = docs.LICENSE ?? '';
  if (license && !(license.startsWith('MIT License') && /Copyright \(c\) \d{4}/.test(license))) {
    problems.push('LICENSE is not the MIT license with a copyright line');
  }
  const readme = docs['README.md'] ?? '';
  if (readme) {
    for (const target of README_LINKS) {
      if (!readme.includes(`](${target})`)) problems.push(`README.md does not link to ${target}`);
    }
  }
  if (version === null) return problems;
  const v = parseVersion(version);
  if (!v) return [...problems, `"${version}" is not a version`];
  const full = v.join('.');
  const minor = `${v[0]}.${v[1]}`;
  if (
    readme &&
    !new RegExp(`^\\| ${minor.replace('.', '\\.')} \\|`, 'm').test(section(readme, '## Roadmap'))
  ) {
    problems.push(`README.md "## Roadmap" has no row for ${minor}`);
  }
  const changelog = docs['CHANGELOG.md'] ?? '';
  if (changelog && !changelog.includes(`## [${full}]`)) {
    problems.push(`CHANGELOG.md has no "## [${full}]" section`);
  }
  const security = section(docs['SECURITY.md'] ?? '', '## Versões com correções');
  if (docs['SECURITY.md'] && !security.includes(`| ${minor}.x`)) {
    problems.push(`SECURITY.md "## Versões com correções" does not list ${minor}.x`);
  }
  return problems;
}

if (import.meta.main) {
  const docs: Docs = {};
  for (const name of REQUIRED_DOCS) {
    try {
      docs[name] = readFileSync(name, 'utf8');
    } catch {
      // reported as missing
    }
  }
  const arg = process.argv[2];
  const version = arg ?? newestRelease(readdirSync('specs/releases'));
  const problems = findDocProblems(docs, version);
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ ${p}`);
    console.error('Update the public documents (constitution §9 item 9) before releasing.');
    process.exit(1);
  }
  console.log(`✔ public documents are complete and up to date for ${version ?? 'no release yet'}`);
}
