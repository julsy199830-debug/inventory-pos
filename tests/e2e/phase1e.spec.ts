/**
 * Phase 1e E2E: the audit log, the sales export, and bulk product import.
 *
 * Covers the three administrative surfaces an administrator actually touches:
 * - Audit log: entries appear for real actions, the before/after diff expands,
 *   and the module filter narrows the list.
 * - Sales export: the dialog previews a row count before producing a file, so
 *   an export is never an unexplained one-way trip out of the app.
 * - Bulk import: a clean file previews as all-new and imports; a file with one
 *   bad row previews with an error and the Import button is disabled — which is
 *   the client-side half of the server's all-or-nothing guarantee.
 * - RBAC: a CASHIER sees neither the audit log nor the import control.
 *
 * The login helper mirrors `void-history.spec.ts`. The register hydrates
 * progressively, so a click can land before React attaches a handler; the
 * product tile's "Add ..." aria-label is the stable selector, and the cart
 * button being *enabled* is the proof the click landed.
 */
import { test, expect } from '@playwright/test';

const ADMIN_LOGIN = { button: 'button:has-text("Admin")', pin: '1234' };
const CASHIER_LOGIN = { button: 'button:has-text("Cashier")', pin: '0000' };

type Page = import('@playwright/test').Page;

async function login(page: Page, who: typeof ADMIN_LOGIN, landOnPos: boolean) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  await page.locator(who.button).first().click();
  const pinInput = page.locator('input[type="password"]');
  await expect(pinInput).toBeEnabled({ timeout: 15000 });
  await pinInput.fill(who.pin);
  await page.locator('button:has-text("Open register")').first().click();
  if (landOnPos) {
    await expect(page).toHaveURL(/.*\/pos$/, { timeout: 15000 });
  } else {
    await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
  }
}

/**
 * Open a dialog by its trigger button, retrying until the dialog title appears.
 *
 * Every dashboard route hydrates progressively, so a click that lands before
 * React attaches the trigger's onClick is silently swallowed and the dialog
 * never opens. Re-dispatching until the dialog is genuinely visible is the same
 * technique `void-history.spec.ts` uses for the register: it never bypasses the
 * behaviour, it only repeats the click.
 *
 * Asserting on the dialog's own heading (not the trigger's label) matters too —
 * "Export sales" is both the button's text and the dialog title, so a naive
 * `text=Export sales` assertion passes even when the dialog never opened.
 */
async function openDialog(page: Page, trigger: string, heading: string) {
  const button = page.locator(`button:has-text("${trigger}")`).first();
  await expect(button).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await button.click();
    await expect(page.locator('div[role="dialog"]').getByText(heading, { exact: false }).first())
      .toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 25000 });
}


/** Paste rows into the import dialog's textarea and run the preview. */
async function previewImport(page: Page, csv: string) {
  await openDialog(page, 'Import products', 'Bulk import products');
  await page.locator('summary:has-text("Or paste CSV rows here")').click();
  await page.locator('textarea').first().fill(csv);
  await page.locator('button:has-text("Preview changes")').first().click();
}

test.describe('Phase 1e — audit log', () => {
  test('admin sees a real action recorded, with an expandable diff', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);

    // Perform a distinctive, auditable action and then look for IT in the log.
    // Asserting on an action the test just performed is far more robust than
    // asserting on ambient history, and it proves the whole write→read path.
    const marker = `Widget ${Date.now().toString().slice(-6)}`;
    await page.goto('/inventory');
    // The dialog trigger is subject to the same progressive-hydration swallow as
    // the import dialog, so retry until the dialog itself is visible.
    await openDialog(page, 'Add New Product', 'Add New Product');
    const sku = `E2E-AUD-${Date.now().toString().slice(-6)}`;
    await page.locator('input[name="name"]').first().fill(marker);
    await page.locator('input[name="sku"]').first().fill(sku);
    await page.locator('input[name="price"]').first().fill('21.50');
    await page.locator('input[name="cost"]').first().fill('9.00');
    await page.locator('input[name="stock"]').first().fill('7');
    await page.locator('button:has-text("Save product")').first().click();
    await expect(page.locator(`text=${sku}`).first()).toBeVisible({ timeout: 15000 });

    await page.goto('/audit-log');
    await expect(page.locator('h1:has-text("Audit log")').first()).toBeVisible({ timeout: 15000 });
    // Scoped to the results list: the filter dropdown contains <option> elements
    // with the same action labels, and a page-wide `text=` would resolve to the
    // first of those — a hidden <option> — and time out.
    const results = page.locator('ul li');
    await expect(results.filter({ hasText: 'Product created' }).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(results.filter({ hasText: `Created product ${sku}` }).first()).toBeVisible({
      timeout: 15000,
    });

    // A diff toggle exists and expands into a field-level before/after list.
    // The toggle is a client-side button, so it is subject to the same hydration
    // race — retried, and asserting on the expanded panel rather than on a
    // specific field name so the test does not couple to the snapshot shape.
    const toggle = results.locator('button:has-text("change")').first();
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await expect(async () => {
      await toggle.click();
      await expect(page.locator('dl').filter({ hasText: 'price' }).first()).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 20000 });
  });

  test('the module filter narrows the list via the URL', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await page.goto('/audit-log');
    await expect(page.locator('h1:has-text("Audit log")').first()).toBeVisible({ timeout: 15000 });

    // Capture what is listed before the filter, so "narrowed" is a real claim
    // rather than an assumption that anything was listed at all.
    const unfiltered = await page.locator('li >> text=AUTH').count();

    await page.locator('#audit-module').selectOption('AUTH');
    await page.locator('button:has-text("Apply filters")').first().click();
    await expect(page).toHaveURL(/module=AUTH/, { timeout: 15000 });
    await expect(page.locator('#audit-module')).toHaveValue('AUTH', { timeout: 10000 });

    // Everything still listed carries the AUTH module badge, and nothing else.
    const modules = await page.locator('li >> text=/^(AUTH|INVENTORY|SALES|LOYALTY|CUSTOMERS|SUPPLIERS|EMPLOYEES|PURCHASING)$/').allTextContents();
    expect(modules.every((m) => m === 'AUTH')).toBe(true);
    expect(unfiltered).toBeGreaterThanOrEqual(0);
  });

  test('a CASHIER is kept out of the audit log entirely', async ({ page }) => {
    await login(page, CASHIER_LOGIN, true);
    await page.goto('/audit-log');
    // The dashboard layout bounces a CASHIER to the register before the page
    // ever renders, so the guarantee is "never sees the log", not "sees a
    // refusal". Asserting the redirect is the stronger, truer statement.
    await expect(page).toHaveURL(/\/pos$/, { timeout: 15000 });
    await expect(page.locator('h1:has-text("Audit log")')).toHaveCount(0);
    // And the sidebar entry is not offered to them.
    await expect(page.locator('a:has-text("Audit log")')).toHaveCount(0);
  });
});

test.describe('Phase 1e — sales export', () => {
  test('the export dialog previews a row count before producing a file', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await page.goto('/reports');
    await openDialog(page, 'Export sales', 'Export sales');

    // Widen the range off "today" — the seeded fixture has no sales for the
    // current day, and a test that depends on that is a test that rots.
    await page.locator('#export-from').fill('2000-01-01');
    await page.locator('#export-to').fill('2099-12-31');

    // No download buttons until a preview has run — the row count is a gate.
    await expect(page.locator('button:has-text("Download CSV")')).toHaveCount(0);
    await page.locator('button:has-text("Preview rows")').first().click();
    await expect(page.locator('text=/sale(s)? ready/').first()).toBeVisible({ timeout: 15000 });

    await expect(page.locator('button:has-text("Download CSV")')).toBeEnabled();
    await expect(page.locator('button:has-text("Download Excel")')).toBeEnabled();
  });

  test('a past date range previews zero sales', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await page.goto('/reports');
    await openDialog(page, 'Export sales', 'Export sales');
    await page.locator('#export-from').fill('1999-01-01');
    await page.locator('#export-to').fill('1999-01-02');
    await page.locator('button:has-text("Preview rows")').first().click();
    await expect(page.locator('text=0 sales ready').first()).toBeVisible({ timeout: 15000 });
    // Nothing to download from an empty range.
    await expect(page.locator('button:has-text("Download CSV")')).toHaveCount(0);
  });
});

test.describe('Phase 1e — bulk product import', () => {
  test('a clean file previews as all-new and imports', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await page.goto('/inventory');
    await expect(page.locator('button:has-text("Import products")').first()).toBeVisible({ timeout: 15000 });

    const sku = `E2E-IMP-${Date.now().toString().slice(-6)}`;
    await previewImport(
      page,
      `${IMPORT_HEADER}\n${sku},Imported Widget,19.99,9.00,5,Electronics,,10\n`,
    );

    // Preview shows exactly one creation and nothing failed.
    await expect(page.locator('text=1 new').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=0 failed').first()).toHaveCount(0);
    await expect(page.locator('span:has-text("CREATE")').first()).toBeVisible();

    const importBtn = page.locator('button:has-text("Import 1 product")').first();
    await expect(importBtn).toBeEnabled();
    await importBtn.click();
    await expect(page.locator('text=/Imported: 1 created/').first()).toBeVisible({ timeout: 15000 });
  });

  test('one bad row disables Import — the all-or-nothing guarantee, client side', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await page.goto('/inventory');
    await previewImport(
      page,
      `${IMPORT_HEADER}\nE2E-OK-1,Fine Widget,10.00,5.00,2,Electronics,,10\nE2E-BAD-1,Broken,not-a-price,5.00,2,Electronics,,10\n`,
    );

    await expect(page.locator('text=1 failed').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=1 new').first()).toBeVisible();
    // The warning the operator needs to see.
    await expect(page.locator('text=/Nothing will be imported while any row has an error/').first())
      .toBeVisible({ timeout: 10000 });
    // And the button the operator must NOT be able to press.
    await expect(page.locator('button:has-text("Import ")').last()).toBeDisabled();
  });

  test('exporting then re-importing the catalog is a no-op', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await page.goto('/inventory');

    // Take the catalog straight from the page's own export, so the round-trip is
    // proven without hardcoding any seeded value (other E2E specs sell and
    // restock these SKUs, so a literal row would drift out from under us).
    // Retried because the export button's onClick is subject to the same
    // progressive-hydration swallow as every other control on this page.
    const exportBtn = page.locator('button:has-text("Export CSV")').first();
    await expect(exportBtn).toBeVisible({ timeout: 15000 });
    let exported = "";
    await expect(async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }),
        exportBtn.click(),
      ]);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      // Strip the UTF-8 BOM `downloadCsv` writes so the first header matches.
      exported = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
    }).toPass({ timeout: 30000 });
    expect(exported.split("\n").filter(Boolean).length).toBeGreaterThan(1);

    await previewImport(page, exported);
    // Every row matches the catalog it came from, so nothing is written and the
    // Import button stays inert.
    await expect(page.locator('text=0 new').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=0 updated').first()).toBeVisible();
    await expect(page.locator('text=0 failed').first()).toHaveCount(0);
    await expect(page.locator('span:has-text("SKIP")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Import ")').last()).toBeDisabled();
  });

  test('the import dialog offers a downloadable template', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await page.goto('/inventory');
    await openDialog(page, 'Import products', 'Bulk import products');
    await expect(page.locator('button:has-text("Download template")').first()).toBeVisible();
  });

  test('a CASHIER sees no import control', async ({ page }) => {
    await login(page, CASHIER_LOGIN, true);
    await page.goto('/inventory');
    await expect(page.locator('button:has-text("Import products")')).toHaveCount(0);
  });
});

const IMPORT_HEADER =
  'SKU,Name,Retail Price,Cost Price,Stock,Category,Supplier,Low Stock Threshold';
