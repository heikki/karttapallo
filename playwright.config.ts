import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4757);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html']],
  use: {
    baseURL,
    trace: 'retain-on-failure'
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
