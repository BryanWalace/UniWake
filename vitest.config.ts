import { defineConfig } from 'vitest/config';

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
