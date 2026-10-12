/**
 * Runs the test suite (`npm test`) and reruns it once only when it failed because a Vitest worker
 * died natively with 0xC0000409 (R-M14-02 / R-M16-01: Windows only, not reproducible outside
 * Vitest) and no test failed. Any other failure fails at once. On GitHub Actions the rerun is shown
 * as a warning annotation, so it never goes unnoticed.
 * Run with `node scripts/ci/test-crash-retry.ts`.
 */
import { spawnSync } from 'node:child_process';

const CRASH = /exit code 3221226505/;
const TEST_FAILED = /^\s*(FAIL|×)\s/m;

function run(): { code: number; output: string } {
  const r = spawnSync('npm', ['test'], {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(output);
  return { code: r.status ?? 1, output };
}

const first = run();
if (first.code === 0) process.exit(0);
const crashed = (first.code === 127 || CRASH.test(first.output)) && !TEST_FAILED.test(first.output);
if (!crashed) process.exit(first.code);

const where = first.output.match(/while running test file (\S+)/)?.[1] ?? 'desconhecido';
const note = `R-M16-01: Vitest worker crashed natively (0xC0000409) in ${where}; rerunning the suite once.`;
console.log(process.env.GITHUB_ACTIONS ? `::warning::${note}` : note);
process.exit(run().code);
