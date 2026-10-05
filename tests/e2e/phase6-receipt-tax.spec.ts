import { test, expect } from '@playwright/test';

/**
 * Phase 6 E2E: receipts and tax under the GLOBAL store settings.
 *
 * Before Phase 6 the receipt built its own money string and treated `taxRate`
 * as a display-only hint. These pin the contract that the receipt obeys the SAME
 * settings as every other screen, and that turning tax off removes the VAT row
 * entirely rather than printing a misleading "VAT - 0.00".
 *
 * The sale mechanics are copied from `phase4-pos.spec.ts` (add product -> F2 ->
 * F9) rather than reinvented, so this spec cannot drift from a proven flow.
 */

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator(ADMIN.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(ADMIN.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
  await page.goto('/pos');
  await expect(page.locator('text=Process Payment').first()).toBeVisible({
    timeout: 20000,
  });
}

async function addProduct(page: Page, name: string) {
  const tile = page.locator(`button[aria-label="Add ${name} to order"]`).first();
  await expect(tile).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await tile.click();
    await expect(page.locator(`input[aria-label="Quantity for ${name}"]`)).toBeVisible();
  }).toPass({ timeout: 15000 });
}

/** Ring up one card sale and LEAVE the completion receipt open. */
async function completeCardSale(page: Page, product = 'Aurora Wireless Headphones') {
  await addProduct(page, product);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('F2');
  await page.keyboard.press('F9');
  await expect(page.locator('text=Sale Complete').first()).toBeVisible({
    timeout: 20000,
  });
}

async function readSettings(page: Page) {
  await page.goto('/settings');
  await expect(page.locator('#taxEnabled')).toBeVisible({ timeout: 20000 });
  return {
    currencySymbol: await page.locator('#currencySymbol').inputValue(),
    taxRate: await page.locator('#taxRate').inputValue(),
    taxEnabled: await page.locator('#taxEnabled').isChecked(),
  };
}

/** Apply settings through the real form and wait for the saved banner. */
async function saveSettings(page: Page, apply: () => Promise<void>) {
  await page.goto('/settings');
  await expect(page.locator('#taxEnabled')).toBeVisible({ timeout: 20000 });
  await apply();
  await page.locator('button:has-text("Save settings")').click();
  await expect(
    page.locator('[role="status"]:has-text("Settings saved")'),
  ).toBeVisible({ timeout: 20000 });
}

async function receiptText(page: Page): Promise<string> {
  await expect(page.locator('text=Sale Complete').first()).toBeVisible({
    timeout: 20000,
  });
  return (await page.locator('body').innerText()).trim();
}
test.describe('Phase 6 — receipts and tax', () => {
  test('a receipt shows the configured currency and a VAT line at the configured rate', async ({
    page,
  }) => {
    await login(page);
    const original = await readSettings(page);

    try {
      await saveSettings(page, async () => {
        await page.locator('#taxRate').fill('12');
        if (!(await page.locator('#taxEnabled').isChecked())) {
          await page.locator('#taxEnabled').check();
        }
      });

      await page.goto('/pos');
      await expect(page.locator('text=Process Payment').first()).toBeVisible({
        timeout: 20000,
      });
      await completeCardSale(page);

      // The rate is rendered INTO the row label, so this asserts a specific
      // value rather than a bare "VAT" substring.
      await expect(page.locator('text=/VAT \\(12%\\)/').first()).toBeVisible({
        timeout: 20000,
      });
      const receipt = await receiptText(page);
      expect(receipt).toMatch(
        new RegExp(`${original.currencySymbol}[\\d,]+\\.\\d{2}`),
      );
    } finally {
      await saveSettings(page, async () => {
        await page.locator('#taxRate').fill(original.taxRate);
        if (original.taxEnabled) await page.locator('#taxEnabled').check();
      });
    }
  });

  test('turning tax off removes the VAT row entirely, with no misleading zero', async ({
    page,
  }) => {
    await login(page);
    const original = await readSettings(page);

    try {
      await saveSettings(page, async () => {
        if (await page.locator('#taxEnabled').isChecked()) {
          await page.locator('#taxEnabled').uncheck();
        }
      });

      await page.goto('/pos');
      await expect(page.locator('text=Process Payment').first()).toBeVisible({
        timeout: 20000,
      });
      await completeCardSale(page);

      // No VAT label at all...
      await expect(page.locator('text=/VAT/')).toHaveCount(0);
      // ...and specifically not a misleading zero-value tax row.
      await expect(
        page.locator(`text=/VAT.*${original.currencySymbol}0\\.00/`),
      ).toHaveCount(0);
    } finally {
      await saveSettings(page, async () => {
        if (original.taxEnabled) await page.locator('#taxEnabled').check();
      });
    }
  });

  test('the receipt prints the configured currency symbol', async ({ page }) => {
    await login(page);
    const original = await readSettings(page);

    try {
      await saveSettings(page, () => page.locator('#currencySymbol').fill('RM'));

      await page.goto('/pos');
      await expect(page.locator('text=Process Payment').first()).toBeVisible({
        timeout: 20000,
      });
      await completeCardSale(page);

      const receipt = await receiptText(page);
      expect(receipt, 'receipt totals must use the configured symbol').toMatch(
        /RM[\d,]+\.\d{2}/,
      );
      expect(receipt).not.toContain(original.currencySymbol);
    } finally {
      await saveSettings(page, () =>
        page.locator('#currencySymbol').fill(original.currencySymbol),
      );
    }
  });
});