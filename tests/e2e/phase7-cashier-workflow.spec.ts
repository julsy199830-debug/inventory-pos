/**
 * Phase 7, Section 3 — the first-time cashier's path through the register.
 *
 * This is not an existence check. Every step asserts that the labels, empty
 * states and guidance on screen actually COMMUNICATE the workflow, in the
 * order a newcomer meets it:
 *
 *   1. understand employee / shift status
 *   2. see where to search / scan a product
 *   3. add a product
 *   4. see it appear in Current Order
 *   5. understand quantity
 *   6. optionally select a customer (the step says it is optional)
 *   7. understand the Total
 *   8. select a payment method
 *   9. complete the sale
 *  10. understand the Sale Complete result
 *  11. start a new sale
 *
 * The shift state is whatever the shared e2e database is left in, so the two
 * state-dependent assertions branch on the strip's own words rather than
 * assuming a punch. Nothing here changes database state it does not need.
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
  await expect(page.locator('input[aria-label="Search or scan products"]')).toBeVisible({
    timeout: 25000,
  });
}

test.describe('Phase 7 - a first-time cashier can follow the register', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the visible workflow reads in order, from shift status to a new sale', async ({
    page,
  }) => {
    // A full pass at a real pace: login already happened, but every click
    // below runs against a hydrated register, and the whole journey must fit
    // one generous budget rather than flaking at the 30s default.
    test.setTimeout(90_000);

    const aside = page.locator('aside');

    // 1. Understand employee / shift status
    // The strip's readiness flag doubles as "the register is hydrated".
    await expect(page.locator('[data-register-loaded="true"]')).toBeVisible({ timeout: 25000 });
    const strip = page.getByTestId('shift-state');
    await expect(strip).toBeVisible({ timeout: 20000 });
    const stripText = (await strip.innerText()).trim();
    // The state is stated in words — never colour alone.
    expect(stripText).toMatch(/^(On shift|Off shift)$/);
    // The header badge reports the SAME state (shared store, one truth).
    const badge = page.getByTestId('header-shift-state');
    await expect(badge).toBeVisible({ timeout: 20000 });
    await expect(badge).toHaveText(stripText);
    // And the control that changes it is named as plain action.
    await expect(
      page.getByRole('button', { name: /Start shift|End shift/ }).first(),
    ).toBeVisible();

    // The walk-in nudge answers the two pre-sale questions — in words that
    // branch with the state the strip just reported.
    const walkinHint = aside.locator('[data-testid="pos-walkin-hint"]');
    // Shared tail of both variants — the branch above decides the head, this
    // pins the promise the brief cares about: the step is optional.
    await expect(walkinHint).toContainText('sales need no customer');
    if (stripText === 'Off shift') {
      await expect(walkinHint).toContainText('Not on the clock yet');
      await expect(walkinHint).toContainText('start your shift above');
    } else {
      await expect(walkinHint).toContainText('Optional');
    }


    // 2. See where to search / scan a product
    const catalogSearch = page.locator('input[aria-label="Search or scan products"]');
    await expect(catalogSearch).toBeVisible();
    // Both boxes describe the job in plain words — neither assumes the
    // cashier already knows what a SKU is.
    await expect(catalogSearch).toHaveAttribute('placeholder', 'Search or scan products');
    await expect(page.locator('#scan-input')).toHaveAttribute(
      'placeholder',
      'Search or scan a product',
    );
    // First-use guidance points at the catalog while the order is empty...
    const catalogHint = page.locator('[data-testid="pos-catalog-hint"]');
    await expect(catalogHint).toContainText('Search by name or scan a barcode');
    // ...and an impossible query explains itself instead of a blank pane.
    await catalogSearch.fill('zzzzqqxx');
    await expect(page.locator('text=No products found').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Try another name or scan a barcode.').first()).toBeVisible();
    await page.locator('button[aria-label="Clear product search"]').click();

    // 3. Add a product
    const tile = page.locator('button[aria-label="Add Aurora Wireless Headphones to order"]');
    // The card says name, price and stock condition IN WORDS before the tap.
    await expect(tile).toContainText('Aurora Wireless Headphones');
    await expect(tile).toContainText(/in stock|Out of stock|Low stock/);
    await expect(async () => {
      await tile.click();
      await expect(
        aside.locator('input[aria-label="Quantity for Aurora Wireless Headphones"]'),
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    // 4. See the item appear in Current Order
    await expect(aside.locator('h2:has-text("Current Order")')).toBeVisible();
    await expect(aside.locator('text=₱129.99 each')).toBeVisible({ timeout: 10000 });
    // The empty-state instruction has retired itself now that there is an
    // order — guidance that disappears with the state it explains.
    await expect(page.locator('text=Find a product to start a new sale.')).toHaveCount(0);
    await expect(catalogHint).toHaveCount(0);

    // 5. Understand quantity
    const qty = aside.locator('input[aria-label="Quantity for Aurora Wireless Headphones"]');
    await expect(qty).toHaveValue('1');
    await aside
      .getByRole('button', { name: 'Increase Aurora Wireless Headphones quantity' })
      .click();
    await expect(qty).toHaveValue('2');

    // 6. Optionally select a customer
    // The picker opens and offers the guest default; the newcomer can see
    // the step is skippable and leave it skipped.
    await expect(async () => {
      await page.locator('#customer-trigger').click();
      await expect(page.locator('#customer-search-input')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await expect(page.getByRole('option', { name: /Walk-in Customer/ }).first()).toBeVisible();
    await page.locator('#customer-search-input').press('Escape');
    await expect(page.locator('#customer-search-input')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#customer-trigger')).toContainText('Walk-in Customer');

    // 7. Understand the Total
    await expect(aside.getByText('Subtotal', { exact: true })).toBeVisible();
    // Plain "Total" — the accounting term "Grand Total" is gone.
    await expect(aside.getByText('Total', { exact: true }).first()).toBeVisible();
    const totalFigure = aside.locator('[data-testid="order-total"]');
    await expect(totalFigure).toBeVisible();
    const totalValue = Number(((await totalFigure.innerText()) ?? '').replace(/[^0-9.]/g, ''));
    expect(totalValue).toBeGreaterThan(0);

    // 8. Select payment
    await expect(aside.getByText('Payment Method', { exact: true })).toBeVisible();
    for (const method of ['Cash', 'Card', 'Credit']) {
      await expect(aside.getByRole('button', { name: method, exact: true })).toBeVisible();
    }
    await aside.getByRole('button', { name: 'Cash', exact: true }).click();
    await expect(
      aside.getByRole('button', { name: 'Cash', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    // The one unmistakable next action, named for what it does.
    const payButton = aside.locator('[data-testid="checkout-button"]');
    await expect(payButton).toBeEnabled();
    await expect(payButton).toContainText('Process Payment');


    // 9. Complete the sale
    await payButton.click();
    const cashDialog = page.locator('div[role="dialog"][aria-label="Collect cash payment"]');
    await expect(cashDialog).toBeVisible({ timeout: 10000 });
    // The cash path reads as the hierarchy the brief promises:
    // Payment → Amount received → Change due → Complete Sale.
    await expect(cashDialog.getByText('Amount received', { exact: true })).toBeVisible();
    await expect(cashDialog).toContainText('Amount due');
    await page.locator('#tendered-input').fill('500');
    await expect(page.locator('[data-testid="change-due"]')).toBeVisible({ timeout: 5000 });
    await expect(cashDialog.getByText('Change due', { exact: true })).toBeVisible();
    await cashDialog.getByRole('button', { name: 'Complete Sale' }).click();

    // 10. Understand the Sale Complete result
    const done = page.locator('div[role="dialog"][aria-label="Sale complete"]');
    await expect(page.getByText('Sale Complete').first()).toBeVisible({ timeout: 20000 });
    await expect(done).toBeVisible();
    // The result names both exits for the newcomer...
    await expect(done).toContainText(
      'Print the receipt if they want one, then start a new sale.',
    );
    await expect(done.locator('.print-receipt').first()).toBeVisible();
    // ...with the repeatable next step as the primary action.
    await expect(done.getByRole('button', { name: 'New Sale' })).toBeVisible();
    await expect(done.getByRole('button', { name: 'Print Receipt' })).toBeVisible();

    // 11. Start a new sale
    await done.getByRole('button', { name: 'New Sale' }).click();
    await expect(done).toBeHidden({ timeout: 10000 });
    await expect(
      page.locator('text=Find a product to start a new sale.').first(),
    ).toBeVisible({ timeout: 15000 });
    // The register is genuinely reset: payment waits for the next order and
    // the first-use guidance is back for whoever rings up next.
    await expect(aside.locator('[data-testid="checkout-button"]')).toBeDisabled();
    await expect(page.locator('[data-testid="pos-catalog-hint"]')).toBeVisible();
    await expect(
      aside.locator('[data-testid="pos-payment-hint"]'),
    ).toContainText('Add a product to take payment.');
  });
});