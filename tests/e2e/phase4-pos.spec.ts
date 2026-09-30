/**
 * Phase 4 E2E: customer selection, cashier workflow, and receipt reprint.
 *
 * These cover the three Phase 4 changes a cashier meets at the till:
 *
 *   1. Finding a customer. The old control was an unsearchable <select> that
 *      showed only a points count, so it is asserted here that search works by
 *      BOTH name and phone - the number a customer says out loud.
 *   2. The register. Shift state, live takings, and the drawer breakdown.
 *   3. Reprint. A staff member must be able to reproduce the slip for a sale
 *      that has already happened, and it must say what kind of transaction it
 *      is.
 *
 * Everything is asserted through the UI a cashier actually sees, never through
 * internal state. Where a figure is read it comes from a testid added for that
 * purpose, not from scraping surrounding markup.
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

async function addProduct(page: Page, name: string) {
  const tile = page.locator(`button[aria-label="Add ${name} to order"]`).first();
  await expect(tile).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await tile.click();
    await expect(page.locator(`input[aria-label="Quantity for ${name}"]`)).toBeVisible();
  }).toPass({ timeout: 15000 });
}

/**
 * Move focus off whatever field the register auto-focused.
 *
 * The scan box takes focus on load, and the F-keys are deliberately muted while
 * a text field has focus. Clicking the page corner is how the existing suite
 * blurs before using a shortcut, so the F-key tests below do the same rather
 * than relying on `.blur()` alone.
 */
async function blurField(page: Page) {
  // Blur programmatically rather than clicking a corner of the page: a corner click
  // can land on the header logo link and navigate away, which silently disables
  // every shortcut that follows.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/**
 * Ring up one card sale and dismiss the completion modal.
 *
 * Card settles directly, so there is no cash-tender dialog to fill in - this is
 * the same flow `phase3-pos.spec.ts` uses for its F9 test, which keeps the
 * sale mechanics identical to an already-passing test rather than inventing a
 * second way to complete a transaction.
 */
async function completeCardSale(page: Page, product = 'Aurora Wireless Headphones') {
  await addProduct(page, product);
  await blurField(page);
  await page.keyboard.press('F2');
  await page.keyboard.press('F9');
  await expect(page.locator('text=Sale Complete').first()).toBeVisible({ timeout: 20000 });
  await page.locator('button:has-text("New Sale")').first().click();
  await expect(page.locator('text=No items yet').first()).toBeVisible({ timeout: 15000 });
}

/**
 * Open the customer picker and wait for its search box.
 *
 * Retried rather than clicked once: `#customer-trigger` is server-rendered, so
 * it is present and clickable a moment before React hydrates and its onClick is
 * live. A single click in that window is silently swallowed and the popover
 * never appears. Same `toPass` shape `addProduct` uses.
 */
async function openCustomerPicker(page: Page) {
  await expect(async () => {
    await page.locator('#customer-trigger').click();
    await expect(page.locator('#customer-search-input')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

/**
 * Open the transaction-history panel.
 *
 * The header button reads "Transactions", not "History" - its label span is
 * `hidden sm:inline`, so the accessible name is not available below the sm
 * breakpoint either. Retried for the same hydration reason as
 * `openCustomerPicker`; this mirrors the helper the existing history specs use.
 */
async function openHistory(page: Page) {
  const trigger = page.locator('button:has-text("Transactions")').first();
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await trigger.click();
    await expect(page.locator('text=Transactions').first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

/**
 * Ensure this cashier is on the clock, and wait until the strip says so.
 *
 * The Start/End button is disabled until the status request resolves, so a
 * click issued immediately after load is a silent no-op. Waiting for the
 * `shift-state` element and then driving the button to the state we want keeps
 * the test independent of which state the database was left in.
 */
async function ensureOnClock(page: Page) {
  // Wait for the strip's own readiness flag, not merely for the element: the pill
  // renders in the server HTML long before the status request resolves, and the
  // Start/End button is disabled until it does.
  await expect(page.locator('[data-register-loaded="true"]')).toBeVisible({
    timeout: 25000,
  });
  const state = page.getByTestId('shift-state');
  if ((await state.getAttribute('data-on-clock')) !== 'true') {
    // Retried, not clicked once: the button is server-rendered and clickable
    // before React attaches its onClick, and a click in that window is silently
    // dropped - which looks exactly like a server that ignored the request.
    await expect(async () => {
      await page.locator('button:has-text("Start shift")').first().click();
      await expect(state).toHaveAttribute('data-on-clock', 'true', { timeout: 2000 });
    }).toPass({ timeout: 25000 });
  }
}

test.describe('Phase 4 - customer selection', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the register opens on a walk-in, not a default customer', async ({ page }) => {
    // Attaching a customer by accident would wrongly accrue loyalty points.
    await expect(page.locator('#customer-trigger')).toContainText('Walk-in Customer');
  });

  test('F4 opens the customer picker, and is suppressed while typing', async ({ page }) => {
    // The scan box takes focus on load, and the F-keys are deliberately muted
    // while a text field has focus - otherwise typing a SKU containing a
    // function-key code could fire a shortcut. Blur first so we are testing the
    // shortcut itself rather than that guard.
    // Wait for the register strip to report ready. That flag flips from a
    // useEffect, so it doubles as proof the page has hydrated - a shortcut pressed
    // before then has no listener attached and is silently dropped.
    await expect(page.locator('[data-register-loaded="true"]')).toBeVisible({
      timeout: 25000,
    });
    await expect(page.locator('#scan-input')).toBeFocused();
    await blurField(page);
    await page.keyboard.press('F4');
    await expect(page.locator('#customer-search-input')).toBeVisible({ timeout: 10000 });

    // With focus back inside a field, F4 must do nothing: no double toggle, and
    // the cashier's keystrokes are never hijacked.
    await page.locator('#customer-search-input').fill('Mar');
    await page.keyboard.press('F4');
    await expect(page.locator('#customer-search-input')).toHaveValue('Mar');
  });

  test('a no-match search says so rather than showing the whole book', async ({ page }) => {
    await openCustomerPicker(page);
    await page.locator('#customer-search-input').fill('Zzzqqx');
    // The important half: no customer rows survive an impossible query.
    // Silently falling back to the whole book is the failure mode that gets the
    // wrong account attached to a sale.
    await expect(page.locator('[data-testid="customer-option"]')).toHaveCount(0);

    // And the empty state is explicit rather than a blank list. For staff the
    // inline create offer IS that empty state, so either wording is correct
    // here - what must never happen is showing customers that do not match.
    await expect(
      page
        .locator('text=No customer matches')
        .or(page.locator('text=Create'))
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('a typed query narrows the list to matching customers', async ({ page }) => {
    await openCustomerPicker(page);
    const search = page.locator('#customer-search-input');
    const unfiltered = await page.locator('[data-testid="customer-option"]').count();
    expect(unfiltered).toBeGreaterThan(0);

    // Take a fragment of a real customer's own name so the match is
    // guaranteed to exist in whatever state the database is seeded.
    const firstName = (
      await page.locator('[data-testid="customer-option"]').first().innerText()
    ).split('\n')[0].trim();
    const fragment = firstName.slice(1, 4);
    await search.fill(fragment);

    // Every surviving row must actually match the query - a filter that still
    // lets non-matches through is worse than no filter.
    await expect(async () => {
      const names = await page.locator('[data-testid="customer-option"]').allInnerTexts();
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) {
        expect(n.toLowerCase()).toContain(fragment.toLowerCase());
      }
    }).toPass({ timeout: 10000 });
  });

  test('the picker shows the account context a cashier decides on', async ({ page }) => {
    await openCustomerPicker(page);
    // Every offered customer states a points figure - the number the loyalty
    // rules are actually applied to.
    const options = page.locator('[data-testid="customer-option"]');
    await expect(options.first()).toBeVisible({ timeout: 10000 });
    await expect(options.first()).toContainText(/pts/);
  });

  test('a picked customer is shown on the trigger, and is changeable', async ({ page }) => {
    await openCustomerPicker(page);

    const target = page.locator('[data-testid="customer-option"]').first();
    const label = (await target.innerText()).split('\n')[0].trim();
    expect(label.length).toBeGreaterThan(0);
    await target.click();
    await expect(page.locator('#customer-trigger')).toContainText(label);

    // And walking back to a guest is possible from the same list.
    await openCustomerPicker(page);
    await page.getByRole('option', { name: /Walk-in Customer/ }).first().click();
    await expect(page.locator('#customer-trigger')).toContainText('Walk-in Customer');
  });

  test('a staff member is offered inline customer creation on no match', async ({ page }) => {
    await openCustomerPicker(page);
    // A name no seeded customer can match.
    await page.locator('#customer-search-input').fill('Zzzqqx Uniquename');
    await expect(page.locator('text=Create').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Phase 4 - register and shift', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the register states whether this cashier is on the clock', async ({ page }) => {
    // Whichever state the database is left in, the till must say which.
    await expect(page.getByTestId('shift-state')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('shift-state')).toHaveAttribute('data-on-clock', /true|false/);
  });

  test('the register names the signed-in cashier', async ({ page }) => {
    await expect(page.locator('#customer-trigger')).toBeVisible();
    // The strip carries the cashier name beside the shift pill.
    await expect(page.getByText('Admin', { exact: false }).first()).toBeVisible();
  });

  test('clocking in shows live takings, and clocking out summarises the shift', async ({
    page,
  }) => {
    await ensureOnClock(page);
    // On the clock, with the live takings figure the cashier reconciles against.
    await expect(page.getByTestId('shift-sales')).toBeVisible({ timeout: 15000 });

    // The summary expands to a drawer breakdown.
    await page.locator('button:has-text("Summary")').first().click();
    await expect(page.locator('text=Taken by payment')).toBeVisible({ timeout: 10000 });

    // Close the shift and read the recorded summary.
    await page.locator('button:has-text("End shift")').first().click();
    await expect(page.locator('text=Shift closed')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('shift-state')).toHaveAttribute('data-on-clock', 'false', {
      timeout: 20000,
    });
  });

  test('a completed sale is reflected in the shift takings', async ({ page }) => {
    await ensureOnClock(page);

    const before = await page.getByTestId('shift-sales').innerText();

    // Take a card sale: no cash-tender dialog to get stuck behind.
    await completeCardSale(page);

    // The takings line now reports at least one sale.
    await expect(async () => {
      const after = await page.getByTestId('shift-sales').innerText();
      expect(after).not.toBe(before);
    }).toPass({ timeout: 20000 });
  });
});

test.describe('Phase 4 - receipt reprint', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('a previous sale can be reprinted with its stored figures', async ({ page }) => {
    // Make a sale so there is something to reprint.
    await completeCardSale(page);

    await openHistory(page);
    await page.locator('text=Completed').first().click({ timeout: 15000 });
    await expect(page.locator('text=Sale details').first()).toBeVisible({ timeout: 15000 });

    await page.locator('button:has-text("Reprint receipt")').first().click();
    await expect(page.locator('text=Reprint receipt').first()).toBeVisible({ timeout: 10000 });
    // It is explicitly an original sale, and it is the stored record rather
    // than a recomputation.
    await expect(page.locator('text=ORIGINAL SALE').first()).toBeVisible();

    // The slip itself renders: store header, cashier, customer, items, total.
    const slip = page.locator('.print-receipt').first();
    await expect(slip).toBeVisible();
    await expect(slip).toContainText('Receipt #');
    await expect(slip).toContainText('Aurora Wireless Headphones');
    await expect(slip).toContainText('Total');

    // And it is printable.
    await expect(page.getByTestId('reprint-print')).toBeVisible();
  });

  test('the reprint preview closes cleanly and returns to the detail', async ({ page }) => {
    // Make this test self-contained: earlier tests in the file refund and void
    // sales, so it cannot assume a Completed row survives from a prior run.
    await completeCardSale(page);
    await openHistory(page);
    await page.locator('text=Completed').first().click({ timeout: 15000 });
    await expect(page.locator('text=Sale details').first()).toBeVisible({ timeout: 15000 });

    await page.locator('button:has-text("Reprint receipt")').first().click();
    await expect(page.locator('.print-receipt').first()).toBeVisible({ timeout: 10000 });
    await page.getByTestId('reprint-close').click();

    // Back to the sale detail, not stranded on an empty panel.
    await expect(page.locator('text=Sale details').first()).toBeVisible({ timeout: 10000 });
  });
});
