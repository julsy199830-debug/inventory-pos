import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPin } from '../../src/lib/pin';

/**
 * Hash-only PIN authentication (Priority 2 — retirement).
 *
 * Drives the REAL login page against a disposable "probe" employee whose DB
 * state is set up directly. `User.pin` no longer exists — the PIN hash is the
 * account's ONLY credential — so this spec proves the permanent properties:
 *
 *   - a correct PIN against a valid `pinHash` authenticates (twice in a row);
 *   - a wrong PIN fails with the generic error and the hash is untouched;
 *   - a malformed `pinHash` fails closed (never authenticates).
 *
 * RULES (matching tests/setup/global-setup.ts policy):
 *  - NO mid-suite reseeding. The probe is a single extra User row, inserted
 *    before the suite's tests and deleted in afterAll — zero impact on the
 *    seeded Admin/Cashier accounts or any other spec.
 *  - PIN literals live in this file as setup inputs only; no PIN/hash value is
 *    ever printed to test output.
 *  - Runs under --workers=1 (the suite standard) so the row's state transitions
 *    are sequential and deterministic.
 */

const PROBE = {
  name: 'Pin Migration Probe',
  email: 'pin-probe@julspos.test',
  pin: '9988',
};

/** Minimal connection shape used here; better-sqlite3 ships no .d.ts (JS-only). */
interface SqliteConn {
  prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
  close(): void;
}

// Honors DATABASE_URL (set by Playwright runs) so the suite can run against an
// isolated copy of the database; falls back to the repo-root dev.db otherwise.
const DB_PATH = process.env.DATABASE_URL
  ? path.resolve(process.cwd(), process.env.DATABASE_URL.replace(/^file:/, ""))
  : path.resolve(__dirname, '..', '..', 'dev.db');

function db(): SqliteConn {
  // better-sqlite3 ships JS-only typings (no .d.ts); the runtime object does
  // have prepare/close — cast through unknown so tsc doesn't trust its guess.
  return new Database(DB_PATH) as unknown as SqliteConn;
}

/** Idempotently create the disposable probe user; returns its row id. */
function ensureProbeUser(pinHash: string): string {
  const conn = db();
  try {
    const existing = conn
      .prepare('SELECT id FROM "User" WHERE email = ?')
      .get(PROBE.email) as { id: string } | undefined;
    if (existing) return existing.id;
    conn
      .prepare(
        `INSERT INTO "User" (id, name, email, passwordHash, pinHash, active, role, createdAt, updatedAt)
         VALUES (?, ?, ?, 'seed-placeholder', ?, 1, 'CASHIER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(randomUUID(), PROBE.name, PROBE.email, pinHash);
    return (conn.prepare('SELECT id FROM "User" WHERE email = ?').get(PROBE.email) as { id: string }).id;
  } finally {
    conn.close();
  }
}

function getProbeRow(): { pinHash: string | null } {
  const conn = db();
  try {
    const row = conn
      .prepare('SELECT pinHash FROM "User" WHERE email = ?')
      .get(PROBE.email) as { pinHash: string | null } | undefined;
    if (!row) throw new Error('probe user vanished');
    return { pinHash: row.pinHash };
  } finally {
    conn.close();
  }
}

function setProbeState(pinHash: string | null): void {
  const conn = db();
  try {
    conn.prepare('UPDATE "User" SET pinHash = ? WHERE email = ?')
      .run(pinHash, PROBE.email);
  } finally {
    conn.close();
  }
}

/** One login attempt through the real UI; returns whether it succeeded. */
async function attemptLogin(
  page: import('@playwright/test').Page,
  pin: string,
): Promise<boolean> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  await page.locator(`button:has-text("${PROBE.name}")`).first().click();
  const pinInput = page.locator('input[type="password"]');
  await expect(pinInput).toBeEnabled({ timeout: 15000 });
  await pinInput.fill(pin);
  await page.locator('button:has-text("Open register")').first().click();
  const outcome = await Promise.race([
    page.waitForURL(/\/(pos|)$/, { timeout: 15000 }).then(() => true),
    page
      .locator('text=Incorrect employee or PIN')
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => false),
  ]);
  // Sign out so the next attempt starts clean (cookie must not leak between
  // attempts — the POS gate would otherwise short-circuit the login).
  await page.context().clearCookies();
  return outcome;
}

test.describe('PIN hash-only authentication', () => {
  test.beforeAll(async () => {
    ensureProbeUser(await hashPin(PROBE.pin));
  });

  test.afterAll(() => {
    // Remove the disposable probe — the shared DB must look untouched to the
    // other specs (seed only upserts Admin/Cashier, so nothing depends on this row).
    const conn = db();
    try {
      conn.prepare('DELETE FROM "User" WHERE email = ?').run(PROBE.email);
    } finally {
      conn.close();
    }
  });

  test('correct PIN against the stored hash authenticates — repeatedly', async ({ page }) => {
    expect(await attemptLogin(page, PROBE.pin)).toBe(true);
    const row = getProbeRow();
    // The ONLY credential is the versioned scrypt hash, and it never changes
    // on a successful login (no migration bookkeeping left to do).
    expect(row.pinHash).toMatch(/^scrypt\$v1\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await attemptLogin(page, PROBE.pin)).toBe(true);
    expect(getProbeRow().pinHash).toBe(row.pinHash);
  });

  test('wrong PIN fails with the generic error and leaves the hash untouched', async ({ page }) => {
    const before = getProbeRow().pinHash;
    expect(await attemptLogin(page, '9999')).toBe(false);
    expect(getProbeRow().pinHash).toBe(before);
  });

  test('malformed pinHash fails closed — no credential, no fallback', async ({ page }) => {
    setProbeState('not-a-valid-scrypt-hash');
    expect(await attemptLogin(page, PROBE.pin)).toBe(false);
    expect(await attemptLogin(page, '7777')).toBe(false);
    // Restore a valid hash so the row is well-formed until afterAll removes it.
    setProbeState(await hashPin(PROBE.pin));
  });
});

