import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

/**
 * Phase 7 Step 5 — Global Search / Quick Navigation.
 *
 * Every test searches for something REAL and follows the answer to its
 * destination: seeded catalog rows for products, a spawned fixture for the
 * customer/PO/sale trio. Nothing here asserts "the dialog exists" — the
 * claim under test is "a user can find X and reach X".
 *
 * Fixture rows are tagged per-run and removed in afterAll, so the shared
 * database looks untouched to the other specs.
 */

type Page = import('@playwright/test').Page;

const TAG = `s5${Date.now().toString().slice(-6)}`;
const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };
const CASHIER = { button: 'button:has-text("Cashier")', pin: '0000' };

type Fixture = {
  customerId: string;
  customerName: string;
  saleId: string;
  saleNumber: string;
  poId: string;
  poNumber: string;
  supplierName: string;
};

function fixture(mode: 'seed' | 'clean'): Fixture | null {
  // `shell: true` is required on Windows; without it a `.cmd` shim spawns and
  // returns no stdout at all (same reason as the manager fixture).
  const res = spawnSync(
    `npx tsx tests/setup/phase7-search-fixture.ts ${mode} ${TAG}`,
    { encoding: 'utf8', env: process.env, shell: true },
  );
  if (res.status !== 0) {
    throw new Error(
      `search fixture ${mode} failed (${res.status}): ${res.stderr || res.stdout || 'no output'}`,
    );
  }
  if (mode === 'clean') return null;
  const line = (res.stdout ?? '')
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error(`search fixture produced no JSON: ${res.stdout}`);
  return JSON.parse(line) as Fixture;
}

async function signIn(page: Page, who: { button: string; pin: string }) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator(who.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(who.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

async function openSearch(page: Page) {
  // Wait for the HYDRATED trigger: SSR paints the button visibly before React
  // attaches onClick / Ctrl+K, and a pre-hydration click silently does nothing
  // (dialog never appears). The component stamps data-hydrated once live.
  const trigger = hydratedTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 25000 });
  await trigger.click();
  await expect(page.getByTestId('global-search-dialog')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('global-search-input')).toBeFocused({ timeout: 10000 });
}

/** The trigger whose React listeners are live (see openSearch). */
function hydratedTrigger(page: Page) {
  return page.locator('[data-testid="global-search-trigger"][data-hydrated="true"]:visible');
}

/** Type a query and wait for the debounced action to answer. */
async function searchFor(page: Page, text: string) {
  await page.getByTestId('global-search-input').fill(text);
  await expect(page.getByTestId('global-search-option').first()).toBeVisible({
    timeout: 15000,
  });
}

let fx: Fixture;

test.beforeAll(() => {
  fx = fixture('seed')!;
});
test.afterAll(() => fixture('clean'));

test.describe('Phase 7 Step 5 — global search', () => {
  test('Ctrl+K opens the search and Escape closes it', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(hydratedTrigger(page)).toBeVisible({
      timeout: 25000,
    });
    await expect(hydratedTrigger(page)).toContainText('Ctrl K');

    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('global-search-dialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('global-search-input')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('global-search-dialog')).toBeHidden({ timeout: 10000 });
  });

  test('Ctrl+K does not fire while typing in a field', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/pos');
    await expect(page.locator('input[aria-label="Search or scan products"]')).toBeVisible({
      timeout: 25000,
    });
    await page.locator('input[aria-label="Search or scan products"]').click();
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('global-search-dialog')).toHaveCount(0);
    await expect(page.locator('input[aria-label="Search or scan products"]')).toBeFocused();
  });

  test('typing a page name navigates to that page', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);
    await searchFor(page, 'purchase');
    const target = page
      .getByTestId('global-search-option')
      .filter({ hasText: 'Purchase Orders' })
      .first();
    await expect(target).toBeVisible();
    await target.click();
    await expect(page).toHaveURL(/\/purchasing$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Purchasing' }).first()).toBeVisible();
  });

  test('arrow keys walk results and Enter opens the highlighted one', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);
    await searchFor(page, 'elec');
    const options = page.getByTestId('global-search-option');
    expect(await options.count()).toBeGreaterThan(1);
    await expect(options.nth(0)).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('data-active', 'true');
    await page.getByTestId('global-search-input').fill('ELEC-0001');
    await expect(options).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/inventory\?q=ELEC-0001/, { timeout: 15000 });
  });

  test('a product search reaches the inventory list filtered to that SKU', async ({
    page,
  }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);
    await searchFor(page, 'ELEC-0001');
    const target = page
      .getByTestId('global-search-option')
      .filter({ hasText: 'Aurora Wireless Headphones' })
      .first();
    await expect(target).toBeVisible();
    await expect(target).toContainText('Product');
    await target.click();
    await expect(page).toHaveURL(/\/inventory\?q=ELEC-0001/, { timeout: 15000 });
    await expect(page.locator('text=Aurora Wireless Headphones').first()).toBeVisible();
  });

  test('a customer search opens that customer directly', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);
    await searchFor(page, fx.customerName);
    const target = page
      .getByTestId('global-search-option')
      .filter({ hasText: fx.customerName })
      .first();
    await expect(target).toBeVisible();
    await expect(target).toContainText('Customer');
    await target.click();
    await expect(page).toHaveURL(new RegExp(`/customers/${fx.customerId}`), {
      timeout: 15000,
    });
  });

  test('a purchase order search opens that order directly', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);
    await searchFor(page, fx.poNumber);
    const target = page
      .getByTestId('global-search-option')
      .filter({ hasText: fx.poNumber })
      .first();
    await expect(target).toBeVisible();
    await expect(target).toContainText('Order');
    await target.click();
    await expect(page).toHaveURL(new RegExp(`/purchasing/${fx.poId}`), {
      timeout: 15000,
    });
    await expect(page.locator(`text=${fx.poNumber}`).first()).toBeVisible();
  });

  test('a sale search surfaces the transaction number', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);
    await searchFor(page, fx.saleNumber);
    const target = page
      .getByTestId('global-search-option')
      .filter({ hasText: `Sale ${fx.saleNumber}` })
      .first();
    await expect(target).toBeVisible();
    await expect(target).toContainText('Sale');
  });

  test('an employee search finds staff by name', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);
    await searchFor(page, 'Admin');
    const target = page
      .getByTestId('global-search-option')
      .filter({ hasText: 'Admin' })
      .first();
    await expect(target).toBeVisible();
    await target.click();
    await expect(page).toHaveURL(/\/employees/, { timeout: 15000 });
  });

  test('a nonsense query explains itself instead of a blank list', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);
    await page.getByTestId('global-search-input').fill('zzzzqqxx-no-such-thing');
    await expect(page.getByTestId('global-search-empty')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('global-search-empty')).toContainText('No matches found.');
    await expect(page.getByTestId('global-search-empty')).toContainText(
      'Try a different name, product, or transaction number.',
    );
    await expect(page.getByTestId('global-search-option')).toHaveCount(0);
  });
});
test.describe('Phase 7 Step 5 — search respects roles', () => {
  test('a CASHIER finds products but never purchasing, staff, or employee rows', async ({
    page,
  }) => {
    await signIn(page, CASHIER);
    await page.goto('/pos');
    await expect(page.locator('[data-testid="global-search-trigger"]:visible')).toBeVisible({
      timeout: 25000,
    });
    await openSearch(page);

    // Products are shared with the till — visible.
    await searchFor(page, 'ELEC-0001');
    await expect(
      page.getByTestId('global-search-option').filter({ hasText: 'Aurora Wireless Headphones' }).first(),
    ).toBeVisible();

    // Purchase orders are management-only — the PO number finds nothing …
    await page.getByTestId('global-search-input').fill(fx.poNumber);
    await expect(page.getByTestId('global-search-empty')).toBeVisible({ timeout: 15000 });
    // … and no management page shortcut leaks either. The dialog is already
    // open from above — just retype, never re-click the trigger (it sits
    // behind the dialog overlay).
    await page.getByTestId('global-search-input').fill('employees');
    // The fresh search must COMPLETE with nothing: the empty-state belongs to
    // the new 'employees' query only after the 220ms debounce + round-trip
    // (asserting options==0 alone would pass vacuously mid-debounce).
    await page.waitForTimeout(900);
    await expect(page.getByTestId('global-search-empty')).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByTestId('global-search-option').filter({ hasText: 'Employees' }),
    ).toHaveCount(0);
  });

  test('an anonymous visitor cannot use search at all', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    // No signed-in session anywhere: the trigger lives behind auth chrome.
    await expect(page.getByTestId('global-search-trigger')).toHaveCount(0);
  });

  test('existing POS payment shortcuts still work after mounting search', async ({
    page,
  }) => {
    await signIn(page, CASHIER);
    await page.goto('/pos');
    await expect(page.locator('[data-register-loaded="true"]')).toBeVisible({
      timeout: 25000,
    });
    // Add the first catalog product, then F2 (card) from outside any field —
    // the shortcut the phase3 spec guards. Search mounts a Ctrl+K listener
    // only; F-keys must be untouched.
    const firstAdd = page.locator('button[aria-label^="Add "]').first();
    await expect(firstAdd).toBeVisible({ timeout: 20000 });
    await firstAdd.click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('F2');
    await expect(
      page.locator('button:has-text("Card")').first(),
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
  });
});
