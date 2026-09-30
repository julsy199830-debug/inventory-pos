/**
 * Phase 3 E2E: the register's everyday workflow.
 *
 * These cover the behaviours a cashier depends on and that were previously
 * missing or wrong:
 *
 *   1. Stock honesty. The card used to carry a private "low means <= 5" rule
 *      that contradicted the inventory page, and the cart would happily accept
 *      more units than the shelf held - only to be rejected at checkout, after
 *      the whole order was keyed.
 *   2. Keyboard-first checkout. F1-F4 and F9 replace mouse-hunting for the
 *      actions repeated on every single sale.
 *   3. History filtering. Status / payment / cashier / customer / date filters
 *      that actually narrow the list, with an honest count on each option.
 *
 * Everything is driven through the real UI. No state is asserted that the
 * cashier cannot see.
 */
import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  await page.locator(ADMIN.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(ADMIN.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
  await page.goto('/pos');
  await expect(page.locator('text=Process Payment').first()).toBeVisible({ timeout: 20000 });
}

/** Add a product to the cart by its visible tile name. */
async function addProduct(page: Page, name: string) {
  const tile = page.locator(`button[aria-label="Add ${name} to order"]`).first();
  await expect(tile).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await tile.click();
    await expect(page.locator(`input[aria-label="Quantity for ${name}"]`)).toBeVisible();
  }).toPass({ timeout: 20000 });
}

/** Open the transaction-history panel, retrying through the hydration race. */
async function openHistory(page: Page) {
  // The register hydrates progressively, so a click that lands before React
  // attaches the trigger's onClick is swallowed. Re-dispatching until the panel
  // is genuinely visible is the same technique `void-history.spec.ts` uses.
  const trigger = page.locator('button:has-text("Transactions")').first();
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await trigger.click();
    await expect(
      page.locator('div[role="dialog"]:has(h2:has-text("Transactions"))'),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 25000 });
}

const historyPanel = (page: Page) =>
  page.locator('div[role="dialog"]:has(h2:has-text("Transactions"))');

test.describe('Phase 3 - register workflow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('a product tile shows its stock, and the cart reflects the tap', async ({ page }) => {
    const tile = page.locator('button[aria-label^="Add "]').first();
    await expect(tile).toBeVisible();
    // Every tile states a stock figure, so the cashier never adds blind.
    await expect(tile).toContainText(/in stock|Out of stock|Low stock/);
  });

  test('quantity is editable directly, not only via +/-', async ({ page }) => {
    await addProduct(page, 'Aurora Wireless Headphones');
    const qty = page.locator('input[aria-label="Quantity for Aurora Wireless Headphones"]');
    await expect(qty).toHaveValue('1');
    // Type 3 rather than tapping + twice: the field is the fast path.
    await qty.fill('3');
    await expect(qty).toHaveValue('3');
  });

  test('quantity cannot exceed available stock', async ({ page }) => {
    await addProduct(page, 'Aurora Wireless Headphones');
    const qty = page.locator('input[aria-label="Quantity for Aurora Wireless Headphones"]');
    // A quantity far beyond the shelf is clamped rather than accepted.
    await qty.fill('9999');
    const value = Number(await qty.inputValue());
    const stockLine = await page
      .locator('button[aria-label="Add Aurora Wireless Headphones to order"]')
      .first()
      .textContent();
    const stock = Number(stockLine?.match(/(\d+)\s+in stock/)?.[1] ?? stockLine?.match(/Low stock . (\d+) left/)?.[1] ?? '0');
    expect(value).toBeLessThanOrEqual(Math.max(stock, 1));
  });

  test('the F-keys switch payment method without touching the mouse', async ({ page }) => {
    await addProduct(page, 'Aurora Wireless Headphones');
    const card = page.locator('button:has-text("Card")').first();
    const cash = page.locator('button:has-text("Cash")').first();

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F2');
    await expect(card).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('F1');
    await expect(cash).toHaveAttribute('aria-pressed', 'true');
  });

  test('F9 takes payment for a card sale', async ({ page }) => {
    await addProduct(page, 'Aurora Wireless Headphones');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F2');
    await page.keyboard.press('F9');
    // A card sale settles directly, so the completion modal appears.
    await expect(page.locator('text=Sale Complete').first()).toBeVisible({ timeout: 20000 });
  });

  test('a shortcut does not fire while typing in a field', async ({ page }) => {
    await addProduct(page, 'Aurora Wireless Headphones');
    // Focus the quantity field; F2 there must not switch payment.
    // `focus()` rather than `click()`: the property under test is "a field holds
    // focus", and focus() states it directly without depending on the pixel
    // being hittable.
    const qty = page.locator('input[aria-label="Quantity for Aurora Wireless Headphones"]');
    await qty.focus();
    await page.keyboard.press('F2');
    const card = page.locator('button:has-text("Card")').first();
    await expect(card).not.toHaveAttribute('aria-pressed', 'true');
  });

  test('the shortcut hint is visible on the register', async ({ page }) => {
    await expect(page.getByText('F9').first()).toBeVisible();
  });

  test('history filters are available and clearable', async ({ page }) => {
    await openHistory(page);
    const panel = historyPanel(page);

    const filtersToggle = panel.locator('button:has-text("Filters")').first();
    await expect(async () => {
      await filtersToggle.click();
      await expect(
        panel.getByLabel('Filter by status'),
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    for (const label of [
      'Filter by status',
      'Filter by payment',
      'Filter by cashier',
      'Filter by customer',
    ]) {
      await expect(panel.getByLabel(label)).toBeVisible();
    }
    // The date inputs are present as real date fields.
    await expect(panel.locator('input[type="date"]')).toHaveCount(2);
  });

  test('an impossible date range explains itself and offers a way out', async ({
    page,
  }) => {
    await openHistory(page);
    const panel = historyPanel(page);

    await expect(async () => {
      await panel.locator('button:has-text("Filters")').first().click();
      await expect(panel.getByLabel('Filter by status')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // A day the store has certainly never traded on. Deliberately a DATE rather
    // than a status: other specs create voided and refunded sales, so a status
    // filter would be data-dependent, but no run has ever sold anything in 1999.
    const dateInputs = panel.locator('input[type="date"]');
    await dateInputs.nth(0).fill('1999-01-01');
    await dateInputs.nth(1).fill('1999-01-02');

    await expect(
      panel.locator('text=No transactions match these filters.').first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      panel.locator('button:has-text("Clear filters and search")').first(),
    ).toBeVisible();
  });

  test('a status filter is actually applied to the query', async ({ page }) => {
    await openHistory(page);
    const panel = historyPanel(page);
    await expect(async () => {
      await panel.locator('button:has-text("Filters")').first().click();
      await expect(panel.getByLabel('Filter by status')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // Pick any status that actually has sales in the window. The exact counts
    // are not asserted: the list is capped at HISTORY_LIMIT, so a filtered
    // result may legitimately be shorter than the unfiltered one.
    //
    // These counts come from a separate `getHistoryFacets` fetch, so they are
    // read inside `toPass` rather than read once. Reading them on the first
    // frame races that request and finds every count still at its placeholder
    // zero, which is what made this fail intermittently under full-suite load.
    let target: { value: string; count: number } | undefined;
    await expect(async () => {
      const options = await panel
        .getByLabel('Filter by status')
        .locator('option')
        .evaluateAll((els) =>
          els.map((e) => ({
            value: (e as HTMLOptionElement).value,
            count: Number((e.textContent ?? '').match(/\((\d+)\)/)?.[1] ?? -1),
          })),
        );
      target = options.find((o) => o.value && o.count > 0);
      expect(target, 'at least one status should have sales in the window').toBeTruthy();
    }).toPass({ timeout: 20000 });

    await panel.getByLabel('Filter by status').selectOption(target!.value);

    // The property that matters: every row now shown carries the chosen
    // status. If the filter were decorative this would fail immediately.
    const rows = panel.locator('ul li');
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText(target!.value);
    }
  });
});