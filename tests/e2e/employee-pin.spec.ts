import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { getE2EDatabasePath } from '../setup/e2e-database';

/**
 * Employee PIN write-path tests (Priority 2 — retirement).
 *
 * Proves through the REAL admin UI that every employee PIN write path stores
 * ONLY a versioned scrypt hash in `User.pinHash` — the account's only
 * credential since the plaintext retirement:
 *
 *   - create employee   → pinHash valid-format, login works
 *   - change PIN        → old hash replaced, old PIN dead, new PIN works
 *   - edit w/o PIN      → existing hash byte-identical (never regenerated)
 *   - seeded accounts   → hash-only (the 1234/0000 literals never stored)
 *
 * RULES (matching tests/setup/global-setup.ts + pin-migration.spec.ts policy):
 *  - NO mid-suite reseeding. One disposable employee row is created here and
 *    deleted in afterAll — zero impact on the seeded Admin/Cashier or other specs.
 *  - PIN literals live in this file as setup inputs only; no PIN/hash value is
 *    ever printed to test output.
 *  - Runs under --workers=1 (suite standard) so state transitions are ordered.
 */

const EMP = {
  name: 'Pin Probe',
  renamed: 'Pin Probe Renamed',
  email: 'pin-probe-employee@julspos.test',
  pin1: '4321',
  pin2: '8765',
};

const SEED_EMAILS = ['admin@julspos.test', 'cashier@julspos.test'];

/** The versioned scrypt wire format produced by hashPin(). */
const HASH_RE = /^scrypt\$v1\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

interface SqliteConn {
  prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
  close(): void;
}

// Playwright must provide the disposable database URL; there is no dev.db fallback.
const DB_PATH = getE2EDatabasePath();

function db(): SqliteConn {
  return new Database(DB_PATH) as unknown as SqliteConn;
}

type EmployeePinRow = { name: string; email: string; pinHash: string | null };

function getEmployeeRow(email: string): EmployeePinRow | undefined {
  const conn = db();
  try {
    return conn
      .prepare('SELECT name, email, pinHash FROM "User" WHERE email = ?')
      .get(email) as EmployeePinRow | undefined;
  } finally {
    conn.close();
  }
}

/** Sign in through the real login page as an admin and land on /employees. */
async function adminLogin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  await page.locator('button:has-text("Admin")').first().click();
  const pinInput = page.locator('input[type="password"]');
  await expect(pinInput).toBeEnabled({ timeout: 15000 });
  await pinInput.fill('1234');
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
  await page.goto('/employees');
  // Hydration-race guard (same pattern as rbac.spec.ts): retry the click+assert.
  await expect(async () => {
    await page.locator('button:has-text("Add Employee")').first().click({ trial: true });
    await expect(page.locator('button:has-text("Add Employee")').first()).toBeVisible();
  }).toPass({ timeout: 15000 });
}

/** One login attempt through the real UI; returns whether it succeeded. */
async function attemptLogin(
  page: import('@playwright/test').Page,
  userLabel: string,
  pin: string,
): Promise<boolean> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  await page.locator(`button:has-text("${userLabel}")`).first().click();
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
  await page.context().clearCookies();
  return outcome;
}

/** Open the Add Employee dialog (hydration-retried) and fill it. */
async function fillAddDialog(
  page: import('@playwright/test').Page,
  fields: { name: string; email: string; pin: string },
): Promise<void> {
  await expect(async () => {
    await page.locator('button:has-text("Add Employee")').first().click();
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 15000 });
  await page.locator('input[name="name"]').fill(fields.name);
  await page.locator('input[name="email"]').fill(fields.email);
  await page.locator('input[name="pin"]').fill(fields.pin);
}

/** Open the Edit dialog for the employee row matching `email` (retried). */
async function openEditDialog(page: import('@playwright/test').Page, email: string): Promise<void> {
  await expect(async () => {
    const row = page.locator('tr', { hasText: email }).first();
    await row.locator('button:has-text("Edit")').click();
    await expect(page.locator('h2:has-text("Edit Employee")')).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 15000 });
}

/** Save the open dialog (hydration-retried) and wait for it to close. */
async function saveDialog(page: import('@playwright/test').Page): Promise<void> {
  await expect(async () => {
    await page.locator('button[type="submit"]:has-text("Save")').click();
    await expect(page.locator('h2:has-text("Add Employee")')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('h2:has-text("Edit Employee")')).toBeHidden({ timeout: 5000 });
  }).toPass({ timeout: 15000 });
}

test.describe('Employee PIN storage (hash-only writes)', () => {
  test.afterAll(() => {
    // Remove the disposable employee — the shared DB must look untouched to
    // the other specs (seed only upserts Admin/Cashier, nothing depends here).
    const conn = db();
    try {
      conn.prepare('DELETE FROM "User" WHERE email = ?').run(EMP.email);
    } finally {
      conn.close();
    }
  });

  test('creating an employee stores ONLY a pinHash — no usable plaintext credential', async ({ page }) => {
    await adminLogin(page);
    await fillAddDialog(page, { name: EMP.name, email: EMP.email, pin: EMP.pin1 });
    await saveDialog(page);

    // The row exists with a valid versioned hash — the only credential.
    let row: EmployeePinRow | undefined;
    await expect
      .poll(() => getEmployeeRow(EMP.email), { timeout: 15000 })
      .toBeDefined();
    row = getEmployeeRow(EMP.email)!;
    expect(row.pinHash).toMatch(HASH_RE);

    // The created employee can sign in with the PIN through the real UI
    // (hash-path authentication).
    expect(await attemptLogin(page, EMP.name, EMP.pin1)).toBe(true);
  });

  test('changing the PIN replaces the hash: old PIN dies, new PIN works', async ({ page }) => {
    await adminLogin(page);
    const before = getEmployeeRow(EMP.email)!.pinHash!;
    await openEditDialog(page, EMP.email);
    await page.locator('input[name="pin"]').fill(EMP.pin2);
    await saveDialog(page);

    let row: EmployeePinRow | undefined;
    await expect
      .poll(() => getEmployeeRow(EMP.email)?.pinHash, { timeout: 15000 })
      .not.toBe(before);
    row = getEmployeeRow(EMP.email)!;
    expect(row.pinHash).toMatch(HASH_RE);

    expect(await attemptLogin(page, EMP.name, EMP.pin1)).toBe(false); // old PIN dead
    expect(await attemptLogin(page, EMP.name, EMP.pin2)).toBe(true); // new PIN works
  });

  test('editing other fields without a PIN leaves the stored hash byte-identical', async ({ page }) => {
    await adminLogin(page);
    const before = getEmployeeRow(EMP.email)!.pinHash!;
    await openEditDialog(page, EMP.email);
    await page.locator('input[name="name"]').fill(EMP.renamed);
    // PIN left blank on purpose — the "keep current" affordance.
    await saveDialog(page);

    let row: EmployeePinRow | undefined;
    await expect
      .poll(() => getEmployeeRow(EMP.email)?.name, { timeout: 15000 })
      .toBe(EMP.renamed);
    row = getEmployeeRow(EMP.email)!;
    expect(row.pinHash).toBe(before); // byte-identical: never regenerated/cleared
  });

  test('seeded accounts are hash-only — the plaintext literals are never stored', async () => {
    for (const email of SEED_EMAILS) {
      const row = getEmployeeRow(email);
      expect(row, `seed user ${email} must exist`).toBeDefined();
      expect(row!.pinHash).toMatch(HASH_RE);
    }
  });
});
