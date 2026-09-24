import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { getE2EDatabasePath } from '../setup/e2e-database';

/**
 * Purchasing (Purchase Orders) — Phase 1 UI smoke tests.
 *
 * Drives the REAL dashboard UI through the full Phase 1 lifecycle:
 *   1. /purchasing loads (list + create trigger + GET filter controls)
 *   2. the create dialog mints a DRAFT that appears in the list
 *   3. /purchasing/[id] renders header, badge, items, peso total
 *   4. order/cancel controls are status-gated and disappear at terminal state
 *
 * RULES (matching tests/setup/global-setup.ts + employee-pin.spec.ts policy):
 *  - NO mid-suite reseeding. The spec creates ONE disposable PO through the UI
 *    and deletes it again in afterAll — zero impact on the seeded baseline.
 *  - Runs under --workers=1 (suite standard) so state transitions are ordered.
 *  - Direct DB access requires the Playwright-provided disposable DATABASE_URL;
 *    it never falls back to the repository's development database.
 */

interface SqliteConn {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): unknown;
  };
  close(): void;
}

const DB_PATH = getE2EDatabasePath();

function db(): SqliteConn {
  return new Database(DB_PATH) as unknown as SqliteConn;
}

let supName = '';
let productName = '';
let productSku = '';
let createdPoNumber = '';

test.beforeAll(() => {
  const conn = db();
  try {
    const sup = conn.prepare('SELECT name FROM Supplier ORDER BY name LIMIT 1').get() as { name: string };
    const prod = conn.prepare('SELECT name, sku FROM Product ORDER BY name LIMIT 1').get() as {
      name: string;
      sku: string;
    };
    supName = sup.name;
    productName = prod.name;
    productSku = prod.sku;
  } finally {
    conn.close();
  }
});

test.afterAll(() => {
  // Remove the disposable PO — the shared DB must look untouched to other specs.
  if (!createdPoNumber) return;
  const conn = db();
  try {
    conn
      .prepare(
        'DELETE FROM PurchaseOrderItem WHERE purchaseOrderId IN (SELECT id FROM PurchaseOrder WHERE poNumber = ?)',
      )
      .run(createdPoNumber);
    conn.prepare('DELETE FROM PurchaseOrder WHERE poNumber = ?').run(createdPoNumber);
  } finally {
    conn.close();
  }
});

/** Sign in through the real login page as an admin, then navigate freely. */
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
}

test.describe('Purchasing (Phase 1 UI)', () => {
  test('1. /purchasing loads with the PO list and create trigger', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/purchasing');
    await expect(page.locator('h1:has-text("Purchasing")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button:has-text("New purchase order")')).toBeVisible();
    // GET-form filter controls are present.
    await expect(page.locator('input[name="q"]')).toBeVisible();
  });

  test('2. create dialog mints a DRAFT that appears in the list', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/purchasing');
    // Hydration-race guard: a pre-hydration click attaches no handler, so
    // retry the REAL click until the modal actually opens.
    await expect(async () => {
      await page.locator('button:has-text("New purchase order")').first().click();
      await expect(page.locator('h2:has-text("New purchase order")')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await page.locator('#po-supplier').selectOption({ label: supName });
    await page.locator('#po-product-1').selectOption({ label: `${productName} (${productSku})` });
    await page.locator('#po-qty-1').fill('2');
    await page.locator('#po-cost-1').fill('10.5');
    await page.locator('button:has-text("Create draft")').click();
    await expect(page.locator('h2:has-text("New purchase order")')).toBeHidden({ timeout: 15000 });
    // The new PO shows up in the list as a Draft (revalidatePath refresh).
    const poLink = page.locator('a').filter({ hasText: /^PO-\d{6}-\d{6}$/ }).first();
    await expect(poLink).toBeVisible({ timeout: 15000 });
    createdPoNumber = (await poLink.textContent()) ?? '';
    expect(createdPoNumber).toMatch(/^PO-\d{6}-\d{6}$/);
    await expect(page.locator('tr', { hasText: createdPoNumber })).toContainText('Draft');
  });

  test('3. detail route renders header, badge, items and peso total', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/purchasing');
    const link = page.locator('a').filter({ hasText: createdPoNumber }).first();
    await expect(link).toBeVisible({ timeout: 15000 });
    await link.click();
    await expect(page).toHaveURL(new RegExp('/purchasing/[0-9a-f-]{36}'));
    await expect(page.locator('h1')).toHaveText(createdPoNumber);
    await expect(page.locator('span:has-text("Draft")').first()).toBeVisible();
    await expect(page.locator('td', { hasText: productName }).first()).toBeVisible();
    // 2 × 10.5 = 21.00, formatted in the app's en-PH/PHP convention.
    await expect(page.locator('text=21.00').first()).toBeVisible();
    await expect(page.locator('text=₱').first()).toBeVisible();
  });

  test('4. order/cancel controls are status-gated through the terminal state', async ({ page }) => {
    test.setTimeout(60000);
    await adminLogin(page);
    // window.confirm gates both transitions — accept them.
    page.on('dialog', (d) => void d.accept());
    await page.goto('/purchasing');
    const link = page.locator('a').filter({ hasText: createdPoNumber }).first();
    await expect(link).toBeVisible({ timeout: 15000 });
    await link.click();
    await expect(page.locator('h1')).toHaveText(createdPoNumber);
    // DRAFT offers both transitions. Same hydration-race guard as test 2: a
    // pre-hydration click submits the form natively (a harmless GET that
    // changes nothing), so retry the real click until the status badge flips.
    await expect(page.locator('button:has-text("Mark as ordered")')).toBeVisible();
    await expect(page.locator('button:has-text("Cancel order")')).toBeVisible();
    await expect(async () => {
      await page.locator('button:has-text("Mark as ordered")').click();
      await expect(page.locator('span:has-text("Ordered")').first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await expect(page.locator('button:has-text("Mark as ordered")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Cancel order")')).toBeVisible();
    await expect(async () => {
      await page.locator('button:has-text("Cancel order")').click();
      await expect(page.locator('span:has-text("Cancelled")').first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    // CANCELLED is terminal — no mutation controls remain.
    await expect(page.locator('button:has-text("Cancel order")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Mark as ordered")')).toHaveCount(0);
  });
});

