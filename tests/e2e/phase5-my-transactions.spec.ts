import { test, expect } from '@playwright/test';

/**
 * Phase 5 E2E: My Transactions — a cashier's OWN sales ledger.
 *
 * The whole point of this screen is SCOPE, so most of these tests are about what
 * it must NOT show. The security property under test is enforced server-side by
 * ANDing the session's own `cashierId` into the Prisma WHERE clause, so it
 * cannot be reached by adding a query parameter — which is exactly what the
 * isolation test below tries.
 *
 * The state is created rather than assumed: each test rings up its own sale(s)
 * through the real register flow, so nothing depends on the seeded database
 * happening to contain a sale for a given cashier.
 */

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };
const CASHIER = { button: 'button:has-text("Cashier")', pin: '0000' };

async function login(
  page: Page,
  who: typeof ADMIN | typeof CASHIER,
  landOnPos: boolean,
) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({
    timeout: 15000,
  });
  await page.locator(who.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(who.pin);
  await page.locator('button:has-text("Open register")').first().click();
  if (landOnPos) {
    await expect(page).toHaveURL(/\/pos/, { timeout: 15000 });
  } else {
    await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
  }
}

/** Wait for the register strip's own readiness flag (proves hydration). */
async function waitForRegister(page: Page) {
  await expect(page.locator('[data-register-loaded="true"]')).toBeVisible({
    timeout: 25000,
  });
  await expect(page.locator('#scan-input')).toBeFocused();
}

/**
 * Add one product to the cart. Retried: the tile is server-rendered and
 * clickable before React attaches its onClick, so a click in that window is
 * silently dropped.
 */
async function addProduct(page: Page, name: string) {
  const tile = page.locator(`button:has-text("${name}")`).first();
  await expect(tile).toBeVisible({ timeout: 20000 });
  await expect(async () => {
    await tile.click();
    await expect(
      page.locator(`input[aria-label="Quantity for ${name}"]`),
    ).toBeVisible();
  }).toPass({ timeout: 20000 });
}

/**
 * Ring up one card sale and dismiss the completion modal.
 *
 * Card settles directly, so there is no cash-tender dialog — the same flow the
 * Phase 3/4 POS specs use, so the sale mechanics are not re-invented here.
 */
async function completeCardSale(page: Page, product: string) {
  await waitForRegister(page);
  await addProduct(page, product);
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.keyboard.press('F2');
  await page.keyboard.press('F9');
  await expect(page.locator('text=Sale Complete').first()).toBeVisible({
    timeout: 25000,
  });
  await page.locator('button:has-text("New Sale")').first().click();
  await expect(page.locator('text=No items yet').first()).toBeVisible({
    timeout: 20000,
  });
}

/** The transaction number the list shows: first 8 chars of the sale id. */
function txnNumber(saleId: string): string {
  return saleId.slice(0, 8).toUpperCase();
}

/** Read the most recent sale id the given user rang up, via the UI. */
async function newestSaleId(page: Page): Promise<string> {
  await page.goto('/my-transactions');
  await expect(page.getByText('My transactions')).toBeVisible({
    timeout: 20000,
  });
  const row = page.locator('li a[href^="/my-transactions/"]').first();
  await expect(row).toBeVisible({ timeout: 20000 });
  const href = await row.getAttribute('href');
  return href!.replace('/my-transactions/', '');
}
test.describe('Phase 5 - my transactions', () => {
  test('a cashier sees their own sales, and only their own', async ({ page }) => {
    await login(page, CASHIER, true);
    // Ring up one sale as the CASHIER.
    await completeCardSale(page, 'Aurora Wireless Headphones');
    const mine = await newestSaleId(page);

    // Now a sale rung up by someone else, in an ISOLATED browser context.
    //
    // Isolation is the whole point: `page.context().newPage()` shares the
    // context's cookie jar, so signing in as Admin there would re-authenticate
    // THIS page too — and the "can the cashier reach it?" assertions below would
    // silently be testing the Admin. A second context gets its own cookies.
    const otherContext = await page.context().browser()!.newContext();
    const other = await otherContext.newPage();
    await login(other, ADMIN, false);
    await other.goto('/pos');
    await completeCardSale(other, 'Nimbus Bluetooth Speaker');
    const theirs = await newestSaleId(other);
    await otherContext.close();

    // The cashier's own sale is listed.
    await expect(
      page.locator(`li a[href="/my-transactions/${mine}"]`),
    ).toBeVisible();

    // The other employee's sale is NOT — not in the list, and not reachable by
    // asking for it directly. The scope is a WHERE-clause AND on the session's
    // own cashierId, so there is no parameter that can widen it.
    await expect(
      page.locator(`li a[href="/my-transactions/${theirs}"]`),
    ).toHaveCount(0);
    await expect(
      page.getByText(txnNumber(theirs), { exact: false }),
    ).toHaveCount(0);

    // Navigating straight to the other cashier's sale must not render it. The
    // scope is `where: { id, cashierId: me.id }`, so the row simply doesn't
    // match and `notFound()` takes over.
    //
    // Asserted on CONTENT, not on the HTTP status: this route streams, so the
    // response status can already be committed as 200 before `notFound()` runs.
    // Whether the sale's data appears is the security property; the status code
    // is a framework detail.
    await page.goto(`/my-transactions/${theirs}`);
    // The app's own 404 (src/app/not-found.tsx), not Next's built-in copy.
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible({
      timeout: 20000,
    });
    // Belt and braces: none of the other sale's identifying content is present.
    await expect(page.getByText(theirs, { exact: false })).toHaveCount(0);
    await expect(page.getByText('Nimbus Bluetooth Speaker')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Reprint receipt' }),
    ).toHaveCount(0);
  });

  test('the filters narrow the ledger and are shareable links', async ({ page }) => {
    await login(page, CASHIER, true);
    await completeCardSale(page, 'Aurora Wireless Headphones');
    await page.goto('/my-transactions');
    await expect(
      page.getByRole('heading', { name: 'Sales' }),
    ).toBeVisible({ timeout: 20000 });
    const rows = page.locator('li a[href^="/my-transactions/"]');
    expect(await rows.count()).toBeGreaterThan(0);

    // A window in the past contains nothing, and says so rather than silently
    // widening back to "everything". (Deterministic: no sale can exist in 2001.)
    await page.fill('input[name="from"]', '2001-01-01');
    await page.fill('input[name="to"]', '2001-01-02');
    await page.locator('button:has-text("Apply")').click();
    await expect(page).toHaveURL(/from=2001-01-01/, { timeout: 20000 });
    await expect(
      page.getByText('No transactions match those filters.'),
    ).toBeVisible();
    await expect(rows).toHaveCount(0);

    // Status is asserted POSITIVELY rather than by "this filter empties the
    // list": the E2E database is a copy of dev.db and already contains sales of
    // every status, so "Voided shows nothing" would be a false expectation.
    // What must hold is that every row shown actually matches the filter.
    await page.goto('/my-transactions?status=Voided');
    await expect(
      page.getByRole('heading', { name: 'Sales' }),
    ).toBeVisible({ timeout: 20000 });
    const voided = page.locator('li a[href^="/my-transactions/"]');
    const voidedCount = await voided.count();
    if (voidedCount > 0) {
      for (const text of await voided.allInnerTexts()) {
        expect(text).toContain('Voided');
      }
    }

    // And a filter the cashier's own new sale DOES match shows up, proving the
    // list is live rather than pinned to one canned result.
    await page.goto('/my-transactions?status=Completed');
    await expect(rows.first()).toBeVisible({ timeout: 20000 });
    for (const text of await rows.allInnerTexts()) {
      expect(text).toContain('Completed');
    }
  });

  test('a sale opens its receipt, ready to reprint', async ({ page }) => {
    await login(page, CASHIER, true);
    await completeCardSale(page, 'Aurora Wireless Headphones');
    const saleId = await newestSaleId(page);

    await page.locator(`li a[href="/my-transactions/${saleId}"]`).click();
    // The detail carries the persisted sale id in full. `.first()` because the
    // receipt prints the same id in uppercase — both are the sale, neither is
    // the wrong one, and strict mode would otherwise reject the ambiguity.
    await expect(
      page.getByText(saleId, { exact: false }).first(),
    ).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByRole('button', { name: 'Reprint receipt' }),
    ).toBeVisible();
    // The receipt itself renders (the print tree is on the page, just hidden
    // until @media print).
    await expect(page.locator('.print-receipt')).toHaveCount(1);
    // The product that was sold is on the slip.
    await expect(page.getByText('Aurora Wireless Headphones')).toBeVisible();
  });

  test('My Transactions is reachable from the register and from My hours', async ({
    page,
  }) => {
    await login(page, CASHIER, true);
    // The POS command-center header links to both cashier screens.
    const posLink = page.locator('a[href="/my-transactions"]').first();
    await expect(posLink).toBeVisible({ timeout: 25000 });
    await expect(
      page.locator('a[href="/my-activity"]').first(),
    ).toBeVisible();

    await page.goto('/my-activity');
    await expect(page.getByText('My hours')).toBeVisible({ timeout: 20000 });
    await page.locator('a[href="/my-transactions"]').first().click();
    await expect(page.getByText('My transactions')).toBeVisible({
      timeout: 20000,
    });
  });

  test('an anonymous visitor cannot reach the ledger', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/my-transactions');
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
  });
});

test.describe('Phase 5 - lock register', () => {
  test('locking the register signs out and records a LOGOUT audit row', async ({
    page,
  }) => {
    await login(page, CASHIER, true);

    await page.locator('button:has-text("Lock")').first().click();
    // Back at the login screen — the session really is gone.
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
    await expect(
      page.locator('button:has-text("Open register")').first(),
    ).toBeVisible();

    // And the ledger is no longer reachable without signing in again.
    await page.goto('/my-transactions');
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });

    // The audit trail records it — read through the UI an auditor uses rather
    // than the database, so this also proves the row is visible where it
    // belongs. The page's own `action` filter is used rather than eyeballing
    // the newest row: the unfiltered list is long, and a filter makes the
    // assertion about "there is a LOGOUT row" rather than "it happened to be
    // near the top".
    await login(page, ADMIN, false);
    await page.goto('/audit-log?action=LOGOUT');
    await expect(page.locator('text=Audit log').first()).toBeVisible({
      timeout: 25000,
    });
    // Scoped to a <p> deliberately: the filter <select> also contains an
    // <option> labelled "Signed out", and an unscoped text match resolves to
    // that hidden option first. What must be asserted is the ROW's summary.
    await expect(
      page.locator('p', { hasText: /^Signed out$/ }).first(),
    ).toBeVisible({ timeout: 25000 });
  });
});