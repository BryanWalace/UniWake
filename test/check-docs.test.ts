import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Docs,
  findDocProblems,
  newestRelease,
  parseVersion,
  REQUIRED_DOCS,
} from '../scripts/check-docs.ts';

const GOOD: Docs = {
  'README.md': `# X
[LICENSE](LICENSE) [a](CONTRIBUTING.md) [b](SECURITY.md) [c](CODE_OF_CONDUCT.md) [d](CHANGELOG.md)

## Roadmap

| Versão | Conteúdo | Situação |
|---|---|---|
| 1.6 | coisas | publicada (1.6.0) |

## Licença
| 1.7 | not in the roadmap section |
`,
  LICENSE: 'MIT License\n\nCopyright (c) 2026 Alguém\n',
  'CONTRIBUTING.md': '# Como contribuir',
  'SECURITY.md': '# Política\n\n## Versões com correções\n\n| 1.6.x (mais recente) | ✅ |\n',
  'CODE_OF_CONDUCT.md': '# Código de conduta',
  'CHANGELOG.md': '# Histórico\n\n## [1.6.0] — 2026-10-18\n',
  '.github/pull_request_template.md': '## O que muda',
};

describe('check:docs (constitution §9 item 9)', () => {
  it('passes complete documents that cite the version', () => {
    expect(findDocProblems(GOOD, '1.6.0')).toEqual([]);
    expect(findDocProblems(GOOD, 'v1.6.0-rc.1')).toEqual([]);
    expect(findDocProblems(GOOD, null)).toEqual([]);
  });

  it('reports a missing document, a non-MIT license and a README without the links', () => {
    const docs: Docs = { ...GOOD, 'CODE_OF_CONDUCT.md': '  ', LICENSE: 'Apache License' };
    delete docs['.github/pull_request_template.md'];
    docs['README.md'] = GOOD['README.md']!.replace('[d](CHANGELOG.md)', '');
    expect(findDocProblems(docs, null)).toEqual([
      'CODE_OF_CONDUCT.md is missing or empty',
      '.github/pull_request_template.md is missing or empty',
      'LICENSE is not the MIT license with a copyright line',
      'README.md does not link to CHANGELOG.md',
    ]);
  });

  it('reports a new version missing from the roadmap, the changelog and the security table', () => {
    // The "| 1.7 |" row after "## Licença" is outside the roadmap section and does not count.
    expect(findDocProblems(GOOD, 'v1.7.0')).toEqual([
      'README.md "## Roadmap" has no row for 1.7',
      'CHANGELOG.md has no "## [1.7.0]" section',
      'SECURITY.md "## Versões com correções" does not list 1.7.x',
    ]);
    expect(findDocProblems(GOOD, 'banana')).toEqual(['"banana" is not a version']);
  });

  it('finds the newest release-notes file by version, not by name order', () => {
    expect(parseVersion('v1.10.2-rc.1')).toEqual([1, 10, 2]);
    expect(parseVersion('notas')).toBeNull();
    expect(newestRelease(['v1.2.0.md', 'v1.10.0.md', 'v1.9.3.md', 'README.md'])).toBe('1.10.0');
    expect(newestRelease([])).toBeNull();
  });

  it("this repository's documents are up to date for its newest release notes", () => {
    const docs: Docs = {};
    for (const name of REQUIRED_DOCS) docs[name] = readFileSync(name, 'utf8');
    expect(findDocProblems(docs, newestRelease(readdirSync('specs/releases')))).toEqual([]);
  });
});
