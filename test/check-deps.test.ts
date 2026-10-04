import { describe, expect, it } from 'vitest';
import { findUnlistedDeps, parseAllowedDeps } from '../scripts/check-deps.ts';

const PLAN = `## 4. Tech
### 4.1 Runtime dependencies (x)
| Package | Workspace | Why | Alternative considered |
|---|---|---|---|
| fastify | server | http | node:http |
| zod | server, shared, web | validation | — |
| react, react-dom | web | UI | — |
Everything else is a devDependency.

## 5. Data model
| notapkg | server | x | y |
`;

describe('check:deps (IMP-029)', () => {
  it('parses the plan table per workspace and stops at the next heading', () => {
    const allowed = parseAllowedDeps(PLAN);
    expect([...(allowed.get('server') ?? [])].sort()).toEqual(['fastify', 'zod']);
    expect([...(allowed.get('web') ?? [])].sort()).toEqual(['react', 'react-dom', 'zod']);
    expect(allowed.get('server')?.has('notapkg')).toBe(false);
  });

  it('accepts justified and internal dependencies', () => {
    expect(
      findUnlistedDeps(PLAN, [
        { name: 'server', dependencies: ['fastify', 'zod', '@uniwake/shared'] },
        { name: 'web', dependencies: ['react'] },
      ]),
    ).toEqual([]);
  });

  it('reports unjustified dependencies, including any root runtime dependency', () => {
    const problems = findUnlistedDeps(PLAN, [
      { name: 'server', dependencies: ['lodash'] },
      { name: 'root', dependencies: ['left-pad'] },
      { name: 'shared', dependencies: ['react'] },
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('"lodash"');
  });

  it('fails loudly when the plan section is missing', () => {
    expect(() => parseAllowedDeps('# nothing')).toThrow(/4.1/);
  });
});
