import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4757);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/specs',
  testMatch: '**/*.e2e.ts',
  outputDir: 'tests/output/results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  reporter:
    process.env.CI === undefined
      ? './tests/reporter.ts'
      : [
          ['./tests/reporter.ts'],
          ['html', { outputFolder: 'tests/output/report', open: 'never' }]
        ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: {
      slowMo:
        process.env.E2E_SLOW === undefined
          ? process.env.E2E_HEADED === '1'
            ? 700
            : 0
          : Number(process.env.E2E_SLOW)
    }
  },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: {
    command: 'bun tests/server.ts',
    url: baseURL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 30_000,
    env: {
      E2E_PORT: String(PORT),
      KARTTAKUVAT_NO_PHOTOS_WRITES: '1'
    }
  }
});
