import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { E2E_DATABASE_URL, assertE2EDatabaseUrl } from './e2e-database';

/**
 * One-time, serial database setup for the whole E2E suite.
 *
 * WHY THIS EXISTS (read before touching):
 * - All Playwright tests share ONE SQLite file (`dev.db` via DATABASE_URL).
 *   SQLite serializes writers, so any seed running *concurrently* with app
 *   writes can deadlock (observed repeatedly as hung `beforeEach` execSync
 *   calls with idle node/tsx processes).
 * - `prisma/seed.ts` is idempotent (upserts products by SKU, users by email),
 *   so running it once here is safe and non-destructive: it refreshes stock,
 *   catalog, tax rate, and the Admin(1234)/Cashier(0000) accounts without
 *   deleting historical sales.
 * - Per-test reseeds are BANNED by this design: they recreate product/user
 *   rows mid-suite (new UUIDs), which orphans in-flight page state and makes
 *   every other spec's cart/details lookups flaky.
 *
 * Runs serially before ALL spec files — each test file then starts from the
 * identical seeded baseline, so no test depends on another test's leftovers.
 *
 * NOTE: this file must stay CommonJS-compatible (`__dirname`, no
 * `import.meta`): Playwright loads global-setup as CJS under this repo's
 * non-module package.json.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TSX_CLI = path.resolve(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

async function globalSetup() {
  assertE2EDatabaseUrl();
  // This must run against the disposable E2E database, never the root dev.db.
  // Invoke the local tsx CLI through Node to avoid Windows .cmd spawning EINVAL
  // failures in Playwright's global-setup process.
  execFileSync(process.execPath, [TSX_CLI, 'prisma/seed.ts'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    timeout: 120000,
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  });
}

export default globalSetup;
