/**
 * Phase 1d E2E: loyalty redemption at the register, and partial refunds in the
 * transaction-history panel.
 *
 * Covers the user-visible halves of the feature:
 * - Redemption: the control only appears once a customer is attached, the cart
 *   total drops by the point value, and the receipt shows the loyalty rows.
 * - Refund: quantity stepping is bounded by what was bought, the amount updates
 *   live, a reason is mandatory, the refund shows up in the audit trail, and a
 *   sale that has refunds can no longer be voided.
 * - Permissions: CASHIER sees neither control.
 *
 * The login / hydration helpers mirror `void-history.spec.ts`: the register
 * hydrates progressively, so the product click is retried until the cart actually
 * updates rather than assuming the first click lands.
 */
import { test, expect } from '@playwright/test';

const CASHIER_LOGIN = { button: 'button:has-text("Cashier")', pin: '0000' };
const ADMIN_LOGIN = { button: 'button:has-text("Admin")', pin: '1234' };

type Page = import('@playwright/test').Page;

async function login(page: Page, who: typeof CASHIER_LOGIN, landOnPos: boolean) {
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
    await page.goto('/pos');
  }
  await expect(page.locator('button:has-text("Transactions")').first()).toBeVisible({ timeout: 15000 });
}

/**
 * Attach the first real customer to the open cart.
 *
 * Phase 4 replaced the register's plain `<select id="customer-select">` with
 * the searchable `CustomerPicker`, so selecting a customer is now an open +
 * click on a result rather than a `selectOption`. These tests care about what
 * loyalty does once a customer is attached, not about how the cashier picks
 * them, so the helper opens the picker and takes the first real row.
 *
 * Retried for the same hydration reason as `addToCart`: the trigger is
 * server-rendered and its onClick is a moment behind the HTML.
 */
async function attachFirstCustomer(page: Page) {
  await expect(async () => {
    await page.locator('#customer-trigger').click();
    await expect(page.locator('#customer-search-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  const option = page.locator('[data-testid="customer-option"]').first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator('#customer-trigger')).not.toContainText('Walk-in Customer');
}

/**
 * Add `times` units of a product to the cart, retrying until the cart updates.
 *
 * Visibility alone is not a real signal: the register hydrates progressively, so
 * a click that lands before React attaches the tile's onClick is swallowed and
 * the cart stays empty. "Process Payment" being *enabled* is the actual proof
 * the cart has a line, so that is what the retry waits on.
 */
async function addToCart(page: Page, product: string, times = 1) {
  const processBtn = page.locator('button:has-text("Process Payment")').first();
  for (let i = 0; i < times; i += 1) {
    await expect(async () => {
      await page.locator(`text=${product}`).first().click();
      await expect(processBtn).toBeEnabled({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
  }
}

/** Complete a CASH sale, dismissing the receipt. */
async function completeCashSale(page: Page) {
  const processBtn = page.locator('button:has-text("Process Payment")').first();
  await expect(processBtn).toBeVisible();
  await processBtn.click();
  await expect(page.locator('text=Collect Cash').first()).toBeVisible({ timeout: 10000 });
  await page.locator('#tendered-input').fill('1000');
  // Wait for the change-due line to reflect the typed amount. That line is
  // derived from React state, so it is proof the input's onChange actually
  // landed — clicking "Complete Sale" before that would submit a null tender
  // and the server would (correctly) refuse it.
  await expect(page.locator('text=Change due').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=Change due').first()).not.toHaveText(/Change due\s*₱0\.00/);
  await page.locator('button:has-text("Complete Sale")').first().click();
  await expect(page.locator('text=Sale Complete').first()).toBeVisible({ timeout: 15000 });
  await page.locator('button[aria-label="Close"]').first().click();
  await expect(page.locator('text=Sale Complete').first()).toBeHidden({ timeout: 10000 });
}

function historyPanel(page: Page) {
  return page.locator('div[role="dialog"]:has(h2:has-text("Transactions"))');
}

async function openHistory(page: Page) {
  await page.locator('button:has-text("Transactions")').first().click();
  await expect(historyPanel(page).locator('input[type="search"]').first()).toBeVisible({ timeout: 10000 });
}

/** Open the details dialog for the newest sale in the history list. */
async function openNewestSaleDetails(page: Page) {
  await openHistory(page);
  await historyPanel(page).locator('li button').first().click();
  await expect(page.locator('text=Sale details').first()).toBeVisible({ timeout: 10000 });
}

/** The cart's grand-total figure. */
function grandTotal(page: Page) {
  return page.locator('span:has-text("Grand Total")').locator('xpath=following-sibling::span[1]');
}

/** Read a rendered peso amount ("₱1,234.50") as a number. */
async function totalValue(locator: import('@playwright/test').Locator): Promise<number> {
  const text = (await locator.textContent()) ?? '';
  const parsed = Number(text.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`not a peso amount: ${JSON.stringify(text)}`);
  return parsed;
}

/** Format a peso amount the way the UI renders it (2dp, no thousands comma). */
function php(value: number): string {
  return `₱${value.toFixed(2)}`;
}

test.describe('Phase 1d — loyalty redemption', () => {
  test('redemption control is hidden for a walk-in and appears for a customer', async ({ page }) => {
    await login(page, CASHIER_LOGIN, true);
    await addToCart(page, 'Aurora Wireless Headphones');

    // No customer -> no redemption affordance at all.
    await expect(page.locator('#redeem-points')).toHaveCount(0);

    await attachFirstCustomer(page);
    await expect(page.locator('#redeem-points')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('redemption-summary')).toContainText('pts');
  });

  test('redeeming points lowers the total and appears on the receipt', async ({ page }) => {
    await login(page, CASHIER_LOGIN, true);
    await addToCart(page, 'Aurora Wireless Headphones');
    await attachFirstCustomer(page);

    // Read the pre-redemption total rather than hardcoding it: the seeded store
    // has tax enabled, and pinning a peso figure would make this test fail
    // every time the tax rate changes for unrelated reasons.
    const before = await totalValue(grandTotal(page));
    expect(before).toBeGreaterThan(0);

    await page.locator('#redeem-points').fill('200');
    await expect(grandTotal(page)).toHaveText(php(before - 2), { timeout: 10000 });
    await expect(page.getByTestId('redemption-summary')).toContainText('200 pts');
    await expect(page.locator('text=Loyalty (200 pts)').first()).toBeVisible();

    await page.locator('button:has-text("Process Payment")').first().click();
    await expect(page.locator('text=Collect Cash').first()).toBeVisible({ timeout: 10000 });
    await page.locator('#tendered-input').fill('1000');
    await expect(page.locator('text=Change due').first()).not.toHaveText(/Change due\s*₱0\.00/);
    await page.locator('button:has-text("Complete Sale")').first().click();

    // The receipt carries the loyalty rows through to the printed output.
    await expect(page.locator('text=Sale Complete').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Loyalty (200 pts)').first()).toBeVisible();
  });

  test('Redeem max can never drive the total below zero', async ({ page }) => {
    await login(page, CASHIER_LOGIN, true);
    await addToCart(page, 'Aurora Wireless Headphones');
    await attachFirstCustomer(page);
    const before = await totalValue(grandTotal(page));

    await page.locator('button:has-text("Redeem max")').first().click();
    // Points are capped at the cart's taxable base, so the total can only fall
    // to zero — never below it, and never below the pre-redemption figure.
    const after = await totalValue(grandTotal(page));
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(before);
  });
});

test.describe('Phase 1d — partial refunds', () => {
  test('admin can refund a single unit and the audit trail appears', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await addToCart(page, 'Aurora Wireless Headphones', 2);
    const saleTotal = await totalValue(grandTotal(page));
    await completeCashSale(page);

    await openNewestSaleDetails(page);
    await page.locator('button:has-text("Refund items")').first().click();
    await expect(page.locator('text=Refund items').first()).toBeVisible({ timeout: 10000 });

    // Nothing staged -> the confirm button is inert.
    await expect(page.getByTestId('refund-amount')).toHaveText(php(0));
    await expect(page.locator('button:has-text("Refund ₱")')).toBeDisabled();

    // One unit of a two-unit sale is half the total the customer actually paid
    // (tax included), which is exactly what the refund must return.
    const half = Math.round(saleTotal / 2 * 100) / 100;
    await page.locator('button[aria-label^="Return one more"]').first().click();
    await expect(page.getByTestId('refund-amount')).toHaveText(php(half), { timeout: 10000 });

    // The stepper is bounded by what was bought: 2 units, so it stops at 2.
    await page.locator('button[aria-label^="Return one more"]').first().click();
    await expect(page.getByTestId('refund-amount')).toHaveText(php(saleTotal), { timeout: 10000 });
    await expect(page.locator('button[aria-label^="Return one more"]').first()).toBeDisabled();
    // Back to one unit so this stays a partial refund.
    await page.locator('button[aria-label^="Return one fewer"]').first().click();
    await expect(page.getByTestId('refund-amount')).toHaveText(php(half), { timeout: 10000 });

    await page.locator('button:has-text("Damaged item")').first().click();
    await page.locator(`button:has-text("Refund ${php(half)}")`).first().click();

    // The detail refreshes: audit trail, per-line refunded count, remaining units.
    await expect(page.locator('text=Refund history').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=1 of 2 refunded').first()).toBeVisible();
    await expect(page.locator('text=1 still returnable').first()).toBeVisible();
  });

  test('a refunded sale can no longer be voided', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await addToCart(page, 'Aurora Wireless Headphones', 2);
    await completeCashSale(page);

    await openNewestSaleDetails(page);
    await page.locator('button:has-text("Refund items")').first().click();
    await page.locator('button[aria-label^="Return one more"]').first().click();
    await page.locator('button:has-text("Damaged item")').first().click();
    await page.locator('button:has-text("Refund ₱")').first().click();

    await expect(page.locator('text=Refund history').first()).toBeVisible({ timeout: 15000 });
    // The void control is gone and the reason is stated plainly.
    await expect(page.locator('button:has-text("Void this sale")')).toHaveCount(0);
    await expect(page.locator('text=can no longer be voided').first()).toBeVisible();
  });

  test('a fully refunded sale offers nothing further to return', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await addToCart(page, 'Aurora Wireless Headphones', 2);
    const saleTotal = await totalValue(grandTotal(page));
    await completeCashSale(page);

    await openNewestSaleDetails(page);
    await page.locator('button:has-text("Refund items")').first().click();
    await page.locator('button[aria-label^="Return one more"]').first().click();
    await page.locator('button[aria-label^="Return one more"]').first().click();
    await page.locator('button:has-text("Damaged item")').first().click();
    await page.locator(`button:has-text("Refund ${php(saleTotal)}")`).first().click();
    await expect(page.locator('text=Refund history').first()).toBeVisible({ timeout: 15000 });

    // Nothing is left to return, so the entry point disappears entirely.
    await expect(page.locator('button:has-text("Refund items")')).toHaveCount(0);
    await expect(page.locator('text=fully returned').first()).toBeVisible();
  });

  test('cashier sees neither the refund nor the void control', async ({ page }) => {
    await login(page, CASHIER_LOGIN, true);
    await addToCart(page, 'Aurora Wireless Headphones');
    await completeCashSale(page);
    await openNewestSaleDetails(page);
    await expect(page.locator('button:has-text("Refund items")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Void this sale")')).toHaveCount(0);
  });
});


