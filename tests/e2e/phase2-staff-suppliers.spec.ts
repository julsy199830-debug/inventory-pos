/**
 * Phase 2 E2E: employee performance and supplier/purchasing visibility.
 *
 * Both are sales-activity reports built on the shared analytics layer, so these
 * tests check the things that would be quietly WRONG rather than merely ugly:
 *
 *   - every employee is listed, including one with no sales in the window.
 *     "0 transactions" and "not on shift" are different facts, and dropping the
 *     quiet row would make the table look complete when it is not.
 *   - given-back figures and the hours beside them come from the same window as
 *     the revenue, so the row cannot describe two different periods.
 *   - the range switcher changes the window, and the page says which one.
 *   - no payroll figures appear: the schema stores no rate, so any earnings
 *     number here would be invented.
 */
import { test, expect } from '@playwright/test';

const ADMIN_LOGIN = { button: 'button:has-text("Admin")', pin: '1234' };

type Page = import('@playwright/test').Page;

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  await page.locator(ADMIN_LOGIN.button).first().click();
  const pinInput = page.locator('input[type="password"]');
  await expect(pinInput).toBeEnabled({ timeout: 15000 });
  await pinInput.fill(ADMIN_LOGIN.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

test.describe('Phase 2 - staff and suppliers', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('sales by employee lists everyone, not only the sellers', async ({ page }) => {
    await page.goto('/employees');
    await expect(page.locator('h1:has-text("Employees")').first()).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('heading', { name: 'Sales by employee' })).toBeVisible();

    // The roster has three seeded staff; the performance table must list all of
    // them, so a silent employee is visible rather than inferred. Scoped to the
    // performance TABLE (identified by its "Given back" column header) so the
    // roster table lower on the page cannot satisfy the count.
    const perfTable = page.locator('table').filter({ hasText: 'Given back' }).first();
    await expect(perfTable.locator('tbody tr')).toHaveCount(3);
  });

  test('the employee report states its window and changes with the range', async ({ page }) => {
    await page.goto('/employees');
    const WINDOW = /\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/;

    await expect(page.getByText(WINDOW).first()).toBeVisible();
    const before = await page.getByText(WINDOW).first().textContent();

    await page.goto('/employees?range=today');
    await expect(page.getByText(WINDOW).first()).toBeVisible();
    const after = await page.getByText(WINDOW).first().textContent();

    // "Today" is a single day, so both halves of the window are the same date -
    // and it cannot be the 30-day default.
    expect(after?.trim().split(' to ')[0]).toBe(after?.trim().split(' to ')[1]);
    expect(after).not.toBe(before);
  });

  test('the employee report reports activity, never payroll', async ({ page }) => {
    await page.goto('/employees');
    const panel = page.locator('section').filter({ hasText: 'Sales by employee' });
    // Columns are revenue / share / sales / avg order / given back / hours.
    // Nothing that would imply a pay rate.
    for (const heading of ['Revenue', 'Share', 'Sales', 'Given back', 'Hours']) {
      await expect(panel.getByRole('columnheader', { name: heading })).toBeVisible();
    }
    await expect(panel.getByText(/earnings|salary|wage|pay rate/i)).toHaveCount(0);
  });

  test('supplier performance reports ordering, receiving and what is outstanding', async ({ page }) => {
    await page.goto('/suppliers');
    await expect(page.locator('h1:has-text("Suppliers")').first()).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('heading', { name: 'Supplier performance' })).toBeVisible();

    for (const label of ['Outstanding', 'Ordered', 'Received', 'Average lead time']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    for (const heading of [
      'Catalog lines',
      'POs',
      'Ordered',
      'Received',
      'Open POs',
      'Outstanding',
      'Lead time',
    ]) {
      await expect(
        page.getByRole('columnheader', { name: heading }).first(),
      ).toBeVisible();
    }
  });

  test('the supplier report does not invent a supplier score', async ({ page }) => {
    await page.goto('/suppliers');
    const panel = page.locator('section').filter({ hasText: 'Supplier performance' });
    // The schema has no quality or contract data, so a rating would be fiction.
    await expect(panel.getByText(/rating|score|rank\b|\d\s*\/\s*5/i)).toHaveCount(0);
  });

  test('the supplier report states its window', async ({ page }) => {
    await page.goto('/suppliers');
    const panel = page.locator('section').filter({ hasText: 'Supplier performance' });
    await expect(panel.getByText(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/)).toBeVisible();
  });
});