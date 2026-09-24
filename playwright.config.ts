import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const E2E_DB_PATH = path.resolve(__dirname, 'test-db', 'e2e.db');
const E2E_DATABASE_URL = `file:./${path.relative(process.cwd(), E2E_DB_PATH).replace(/\\/g, '/')}`;

const E2E_PREPARE = 'node tests/setup/prepare-e2e-db.cjs';

// Playwright test workers and the web server must resolve the same disposable DB.
process.env.DATABASE_URL = E2E_DATABASE_URL;

/**
 * Playwright E2E test configuration for InvPos.
 * The web server and global setup use a disposable copy of the root database.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Tests inside a file are NOT run in parallel: every spec shares one SQLite
   * file, and intra-file parallelism would reintroduce the writer contention
   * this config exists to prevent. Combined with `workers: 1` below, the whole
   * suite is deterministic and order-independent per file. */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Serial workers: every spec shares ONE SQLite file (DATABASE_URL), and the
   * driver serializes writers — concurrent workers deadlock against the same
   * db file (observed as hung test runs). Do NOT raise this without first
   * giving each worker its own database. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Seed the shared SQLite database once, serially, BEFORE any spec file runs.
   * See tests/setup/global-setup.ts for why this must be exactly-once and
   * serial: per-test reseeds recreate product/user rows mid-suite and deadlock
   * concurrent writers against the single dev.db file. Plain relative path
   * (no require.resolve) because the TS config may load as ESM. */
  globalSetup: './tests/setup/global-setup',
  /* Shared settings for all projects. */
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    actionTimeout: 15000,
    navigationTimeout: 15000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `${E2E_PREPARE} && npm run dev`,
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120000,
    env: { DATABASE_URL: E2E_DATABASE_URL },
  },
});