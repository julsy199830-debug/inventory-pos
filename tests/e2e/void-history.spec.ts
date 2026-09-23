import { test, expect } from '@playwright/test';

/**
 * POS Transaction History + Sale Details + Full Void — Phase 4 E2E tests.
 *
 * Covers:
 * - History list: recent sales appear, Completed/Voided badges distinguishable.
 * - Search: server-side filter by sale ID / customer / cashier text.
 * - Details: items, totals, cash Tendered/Change rows.
 * - Permissions: CASHIER sees no void control; ADMIN/MANAGER do.
 * - Void: preset reason required (empty reason disables confirm), void marks
 *   the sale Voided via the existing voidSale() server action.
 */

const CASHIER_LOGIN = { button: 'button:has-text("Cashier")', pin: '0000' };
const ADMIN_LOGIN = { button: 'button:has-text("Admin")', pin: '1234' };

async function login(page: import('@playwright/test').Page, who: typeof CASHIER_LOGIN, landOnPos: boolean) {
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
    // ADMIN/MANAGER land on the dashboard after sign-in; navigate to the register.
    await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
    await page.goto('/pos');
  }
  // Role-neutral register marker: cashiers see the "InvPos Register" title,
  // while ADMIN/MANAGER see the Dashboard breadcrumb — the Transactions
  // button is present for every role.
  await expect(page.locator('button:has-text("Transactions")').first()).toBeVisible({ timeout: 15000 });
}

/** Completes one CASH sale (Aurora headphones, tender 1000) and returns to the register. */
async function completeCashSale(page: import('@playwright/test').Page) {
  // NOTE (test-infra): the register page hydrates progressively (notably when
  // reached via a full page.goto, as ADMIN/MANAGER do from the dashboard). A
  // click that lands before React attaches the tile's onClick is swallowed:
  // the cart stays empty and "Process Payment" remains disabled forever. Retry
  // the click until the cart line appears — the visibility assertion below is
  // the real one; the retry only re-dispatches the event, it never bypasses it.
  await expect(async () => {
    await page.locator('text=Aurora Wireless Headphones').first().click();
    await expect(page.locator('text=₱129.99 each').first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 15000 });
  const processBtn = page.locator('button:has-text("Process Payment")').first();
  await expect(processBtn).toBeVisible();
  await processBtn.click();
  await expect(page.locator('text=Collect Cash').first()).toBeVisible({ timeout: 10000 });
  await page.locator('#tendered-input').fill('1000');
  await page.locator('button:has-text("Complete Sale")').first().click();
  await expect(page.locator('text=Sale Complete').first()).toBeVisible({ timeout: 15000 });
  // Dismiss the receipt modal via its close button.
  await page.locator('button[aria-label="Close"]').first().click();
  await expect(page.locator('text=Sale Complete').first()).toBeHidden({ timeout: 10000 });
}

async function openHistory(page: import('@playwright/test').Page) {
  await page.locator('button:has-text("Transactions")').first().click();
  await expect(page.locator('input[type="search"]').first()).toBeVisible({ timeout: 10000 });
}

test.describe('POS Transaction History & Void', () => {
  test('cashier sees history and details but cannot void', async ({ page }) => {
    await login(page, CASHIER_LOGIN, true);
    await completeCashSale(page);

    await openHistory(page);

    // The freshly completed sale appears with a Completed badge
     
    await expect(page.locator('text=Completed').first()).toBeVisible({ timeout: 10000 });

    // Search: a nonsense query yields the empty state (server-side filtering)
    await page.locator('input[type="search"]').first().fill('zzz-no-such-transaction');
    await expect(page.locator('text=No transactions found for this filter.').first()).toBeVisible({ timeout: 10000 });
    await page.locator('input[type="search"]').first().fill('');

    // Open sale details on the first (newest) completed row
    await page.locator('text=Completed').first().click();
    await expect(page.locator('text=Sale details').first()).toBeVisible({ timeout: 10000 });

    // Cash rows present
    await expect(page.locator('text=Tendered').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Change').first()).toBeVisible();

    // CASHIER must NOT see the void control (server still enforces this)
    await expect(page.locator('button:has-text("Void this sale")')).toHaveCount(0);
  });

  test('admin can void a completed sale with a preset reason', async ({ page }) => {
    await login(page, ADMIN_LOGIN, false);
    await completeCashSale(page);

    await openHistory(page);
    await expect(page.locator('text=Completed').first()).toBeVisible({ timeout: 10000 });

    // Open details for the newest completed sale
    await page.locator('text=Completed').first().click();
    await expect(page.locator('text=Sale details').first()).toBeVisible({ timeout: 10000 });

    // ADMIN sees the void control
    const voidBtn = page.locator('button:has-text("Void this sale")').first();
    await expect(voidBtn).toBeVisible();
    await voidBtn.click();

    // Confirmation dialog
    await expect(page.locator('text=Void this sale?').first()).toBeVisible({ timeout: 10000 });

    // Empty reason keeps "Confirm void" disabled
    await expect(page.locator('button:has-text("Confirm void")')).toBeDisabled();

    // Pick a preset reason, then confirm
    await page.locator('button:has-text("Wrong item")').first().click();
    await page.locator('button:has-text("Confirm void")').first().click();

    // Details refresh to the Voided state with void metadata
    await expect(page.locator('text=Voided transaction').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Reason:').first()).toBeVisible();

    // The void control disappears for the now-voided sale
    await expect(page.locator('button:has-text("Void this sale")')).toHaveCount(0);

    // Close the details modal (scoped: the list modal behind it also has a Close button)
    // and the still-open history list shows the sale as Voided (list was refreshed on void).
    await page
      .locator('div[role="dialog"]:has(h2:has-text("Sale details")) button[aria-label="Close"]')
      .click();
    await expect(page.locator('text=Voided').first()).toBeVisible({ timeout: 10000 });
  });
});
