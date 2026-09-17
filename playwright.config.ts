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
  // The runner's speed swings about 2x between a good run and a bad one, and
  // on a slow one the specs that sit near 2s land past the 5s default — which
  // is how most of this suite's red builds happened, every one of them on a
  // commit that touched only docs. A timeout bounds how long a failure takes
  // to report, not how long a pass takes, so the slack is free on green runs.
  expect: { timeout: process.env.CI === undefined ? 5_000 : 15_000 },
  // Kept clear of the expect timeout above so the assertion is what gives out
  // first: its message names the locator and diffs the text, where the test
  // timeout would only say the test ran long.
  timeout: process.env.CI === undefined ? 30_000 : 60_000,
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
      E2E_PORT: String(PORT)
    }
  }
});
