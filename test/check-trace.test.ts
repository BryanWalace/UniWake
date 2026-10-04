import { describe, expect, it } from 'vitest';
import { acsInTestTitles, checkTrace, parseSpecAcs, parseTasks } from '../scripts/check-trace.ts';

const SPEC = `
### FR-001
- AC-001-01a [CI-Win]: Given a clean runner, Then ok.
- AC-001-01b [manual]: Given a reboot, Then ok.
- AC-001-02: Given v(N), Then data kept. Mentions AC-001-99 inline, which is not an AC item.
`;

const TASKS = `
| ID | Task |
|---|---|
| [x] M8-T09 | smoke | FR-001 | AC-001-01a, AC-001-01b | — |
| [ ] M8-T10 | upgrade | FR-001 | AC-001-02 | — |
`;

describe('check:trace (IMP-030)', () => {
  it('parses spec ACs and the [manual] marker', () => {
    const acs = parseSpecAcs(SPEC);
    expect([...acs.keys()]).toEqual(['AC-001-01a', 'AC-001-01b', 'AC-001-02']);
    expect(acs.get('AC-001-01b')?.manual).toBe(true);
    expect(acs.get('AC-001-01a')?.manual).toBe(false);
  });

  it('parses task rows with status and AC refs', () => {
    expect(parseTasks(TASKS)).toEqual([
      { id: 'M8-T09', done: true, acs: ['AC-001-01a', 'AC-001-01b'] },
      { id: 'M8-T10', done: false, acs: ['AC-001-02'] },
    ]);
  });

  it('finds AC IDs only in test titles (Vitest and Pester)', () => {
    const src = `
      it('AC-001-01a installs the service', () => {});
      const x = 'AC-009-09'; // not a title
      It 'AC-007-01 chooses the wired adapter' {
      describe("AC-002-01 and AC-002-03", () => {});
    `;
    expect([...acsInTestTitles(src)].sort()).toEqual([
      'AC-001-01a',
      'AC-002-01',
      'AC-002-03',
      'AC-007-01',
    ]);
  });

  it('passes when done tasks have tests for their automated ACs (manual ACs exempt)', () => {
    const r = checkTrace(SPEC, TASKS, [`it('AC-001-01a smoke', () => {})`]);
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ testedAcs: 1, totalAcs: 2 });
  });

  it('fails for a done task without tests, unreferenced ACs and unknown ACs', () => {
    const tasks = `| [x] M8-T09 | smoke | AC-001-01a, AC-001-77 | — |`;
    const r = checkTrace(SPEC, tasks, []);
    expect(r.errors).toEqual([
      'AC-001-01b is not referenced by any task in tasks.md',
      'AC-001-02 is not referenced by any task in tasks.md',
      'M8-T09 is done but AC-001-01a has no test whose title contains "AC-001-01a"',
      'M8-T09 references AC-001-77, which is not in spec.md',
    ]);
  });
});
