import { defineConfig } from 'vitest/config';

// Same zone as CI (ubuntu runners are UTC): a test that only passes in the developer's zone
// (America/Sao_Paulo) fails here first. Set TZ explicitly to try another zone.
process.env.TZ ??= 'UTC';

/** Core modules (constitution §5): coverage must stay ≥ 80% on all four metrics. */
const CORE = [
  'apps/server/src/domain/**/*.ts',
  'apps/server/src/application/**/*.ts',
  'packages/shared/src/**/*.ts',
];

export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      { test: { name: 'root', include: ['test/**/*.test.ts'] } },
      { test: { name: 'shared', root: 'packages/shared', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'web',
          root: 'apps/web',
          environment: 'jsdom',
          include: ['test/**/*.test.{ts,tsx}'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        test: {
          name: 'server',
          root: 'apps/server',
          // R-M14-02: on Windows a forked worker sometimes died at exit with 0xC0000409 (native
          // fail-fast while tearing down sockets/SQLite), failing a random file. Worker threads
          // end without that process teardown: 0 crashes in repeated full runs.
          pool: 'threads',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.perf.test.ts'],
          setupFiles: ['test/setup/network-guard.ts'],
        },
      },
      {
        // Wall-clock budgets: run alone, sequentially and uninstrumented (npm run test:perf).
        test: {
          name: 'perf',
          root: 'apps/server',
          include: ['test/**/*.perf.test.ts'],
          setupFiles: ['test/setup/network-guard.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: CORE,
      exclude: ['apps/server/src/application/demo/**', '**/*.d.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
