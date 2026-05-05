import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4757);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: {
      slowMo:
        process.env.E2E_SLOW === undefined
          ? process.argv.includes('--headed')
            ? 700
            : 0
          : Number(process.env.E2E_SLOW)
    }
  },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: {
    command: 'bun e2e/server.ts',
    url: baseURL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 30_000,
    env: { E2E_PORT: String(PORT) }
  }
});
