import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// The sample paths below are virtual (not in any tsconfig), so type-aware parsing is turned off
// for them. The rules under test do not need type information.
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      ...tseslint.configs.disableTypeChecked,
      languageOptions: { parserOptions: { projectService: false, project: null } },
    },
  ],
});

/** Lints `code` as if it lived at `filePath` and returns the rule ids that fired. */
async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

describe('lint rules (constitution §2.1, §4.1, §5)', () => {
  it('domain cannot import application, adapters, db or http', async () => {
    for (const layer of ['application', 'adapters', 'db', 'http']) {
      const ids = await ruleIds(
        'apps/server/src/domain/sample.ts',
        `import { x } from '../${layer}/thing';\nexport const y = x;\n`,
      );
      expect(ids, layer).toContain('no-restricted-imports');
    }
  });

  it('domain cannot import Node built-ins', async () => {
    const ids = await ruleIds(
      'apps/server/src/domain/sample.ts',
      `import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n`,
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('application cannot import adapters or db', async () => {
    for (const layer of ['adapters', 'db', 'http']) {
      const ids = await ruleIds(
        'apps/server/src/application/sample.ts',
        `import { x } from '../${layer}/thing';\nexport const y = x;\n`,
      );
      expect(ids, layer).toContain('no-restricted-imports');
    }
  });

  it('http cannot import adapters or db', async () => {
    for (const layer of ['adapters', 'db']) {
      const ids = await ruleIds(
        'apps/server/src/http/sample.ts',
        `import { x } from '../${layer}/thing';\nexport const y = x;\n`,
      );
      expect(ids, layer).toContain('no-restricted-imports');
    }
  });

  it('network and process modules are only allowed in adapters', async () => {
    for (const mod of ['node:dgram', 'node:net', 'node:dns', 'node:child_process', 'dgram']) {
      const code = `import * as m from '${mod}';\nexport const y = m;\n`;
      expect(await ruleIds('apps/server/src/application/sample.ts', code), mod).toContain(
        'no-restricted-imports',
      );
      expect(await ruleIds('apps/server/src/adapters/sample.ts', code), mod).not.toContain(
        'no-restricted-imports',
      );
    }
  });

  it('dangerouslySetInnerHTML is forbidden in the web app', async () => {
    const ids = await ruleIds(
      'apps/web/src/sample.tsx',
      `export const C = (p: { h: string }) => <div dangerouslySetInnerHTML={{ __html: p.h }} />;\n`,
    );
    expect(ids).toContain('no-restricted-syntax');
  });

  it('explicit any is an error', async () => {
    const ids = await ruleIds(
      'apps/server/src/domain/sample.ts',
      `export const f = (x: any): number => x as number;\n`,
    );
    expect(ids).toContain('@typescript-eslint/no-explicit-any');
  });
});
