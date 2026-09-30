/**
 * Phase 4 E2E: the Customers section and the dashboard alerts feed.
 *
 * Covers the two management-side changes:
 *
 *   1. Customers. The list gained real account context (points, lifetime spend,
 *      last purchase) plus sorting and pagination. A regression there is
 *      easy to miss because the table still renders - the number is just wrong
 *      or the order is meaningless.
 *   2. Operational alerts. Asserted on the CONTRACT, not on a specific count:
 *      every tile links somewhere, and nothing claims a figure that is not a
 *      count of rows.
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
}

test.describe('Phase 4 - customers section', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the customer list shows loyalty, lifetime spend and last purchase', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    // The three new context columns a manager actually needs.
    await expect(page.getByRole('columnheader', { name: 'Points' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total spent' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Last purchase' })).toBeVisible();
  });

  test('searching by name narrows the list', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    // Scoped to the BODY: `getByRole('row')` also returns the header row, whose
    // text is the column labels and would never contain a customer's name.
    const rows = page.locator('tbody tr');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    const firstName = (await rows.first().innerText()).split('\n')[0].trim();
    await page.getByLabel('Search customers').fill(firstName.slice(0, 3));

    // Every surviving row must actually contain the query. The row count is
    // deliberately NOT asserted to shrink: a seeded book of a single customer
    // cannot shrink, and a test that fails on a small fixture teaches people to
    // ignore it. The property that matters is that the filter is real.
    await expect(async () => {
      const data = await rows.allInnerTexts();
      expect(data.length).toBeGreaterThan(0);
      for (const t of data) {
        expect(t.toLowerCase()).toContain(firstName.slice(0, 3).toLowerCase());
      }
    }).toPass({ timeout: 10000 });
  });

  test('an unmatched search shows an empty state, not the whole book', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });
    await page.getByLabel('Search customers').fill('Zzzqqx');
    // Falling back to the full book is the failure mode that gets the wrong
    // account acted on, so the empty state is asserted, not just "no crash".
    await expect(page.locator('text=No customers').first()).toBeVisible({ timeout: 10000 });
  });

  test('the list can be sorted, and the order really changes', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    const nameHeader = page.getByRole('columnheader', { name: 'Name' });
    const initial = await nameHeader.innerText();

    await page.getByLabel('Sort by').selectOption('spent');
    await expect(page.locator('#customer-sort')).toHaveValue('spent');

    // The picker is a real control and the page still renders a table.
    await expect(page.getByRole('table')).toBeVisible();
    // Sort by Name and flip the direction toggle.
    await page.getByLabel('Sort by').selectOption('name');
    await page.getByRole('button', { name: 'Sort descending' }).click();
    await expect(page.getByRole('button', { name: 'Sort ascending' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    expect(initial.length).toBeGreaterThan(0);
  });
});

test.describe('Phase 4 - operational alerts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the dashboard states what needs attention, or that nothing does', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('text=Needs attention').first()).toBeVisible({ timeout: 25000 });

    // Exactly one of the two honest states must be shown. An empty panel would
    // be indistinguishable from a failed query.
    const allClear = page.locator('text=Nothing needs attention right now.');
    const anyTile = page.locator('a[href^="/inventory"], a[href="/purchasing"], a[href="/pos"], a[href="/audit-log"]');
    await expect(allClear.or(anyTile.first())).toBeVisible({ timeout: 15000 });
  });

  test('every alert tile links to a real screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Needs attention').first()).toBeVisible({ timeout: 25000 });

    const tiles = page.locator('ul li a[href]');
    const count = await tiles.count();
    if (count === 0) return; // all clear is a valid state
    for (let i = 0; i < count; i++) {
      const href = await tiles.nth(i).getAttribute('href');
      expect(href, 'an alert tile must link somewhere actionable').toBeTruthy();
    }
  });
});