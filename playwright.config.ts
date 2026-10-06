import { defineConfig, devices } from '@playwright/test';

const PORT = 47190;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // one hub, one database
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // NFR-09: the installed Microsoft Edge (Windows CI job; npm run e2e:edge).
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
      testMatch: ['smoke.spec.ts', 'wake.spec.ts'],
    },
  ],
  webServer: {
    command: 'node --import tsx scripts/e2e-server.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
