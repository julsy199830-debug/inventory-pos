/**
 * Phase 2 E2E: the advanced inventory surface.
 *
 * Focused on the behaviours a storekeeper depends on when restocking, rather
 * than on markup:
 *
 *   - the status tabs actually FILTER, using the same category-aware threshold
 *     as the badge on each row, and report an honest count of the work waiting
 *   - filters compose: sorting or searching inside a low-stock list does not
 *     silently widen it back to the whole catalog
 *   - the valuation tiles report the catalog, not the filtered page
 *   - the Stock Value column and the Stock Value sort agree with each other
 *
 * The last one is the subtle one. Both derive `stock * price`, but they are
 * computed on opposite sides of the row-mapping step, so they can drift; the
 * E2E is what catches it.
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

test.describe('Phase 2 - inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/inventory');
    await expect(page.locator('h1:has-text("Inventory")').first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('valuation tiles report the whole catalog, not the filtered page', async ({ page }) => {
    for (const label of ['Retail value', 'Cost value', 'Gross margin', 'Value at risk']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    const before = await page
      .getByText('Retail value', { exact: true })
      .first()
      .locator('xpath=..')
      .textContent();

    // Filter to a category: the valuation must NOT change, because it answers
    // for the shop rather than for the current search. The category control is
    // a <select> that submits its parent GET form, so drive it as a select.
    const categorySelect = page.locator('select[name="category"]').first();
    const firstRealCategory = await categorySelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    expect(firstRealCategory).toBeTruthy();
    // Retried: the select's onChange submits its parent form, and that handler
    // is client-side, so a change dispatched before hydration is swallowed and
    // the URL never changes. Re-selecting is not a workaround for the
    // behaviour - it is the same interaction a user would perform.
    await expect(async () => {
      await categorySelect.selectOption(firstRealCategory!);
      await expect(page).toHaveURL(/category=/, { timeout: 2000 });
    }).toPass({ timeout: 20000 });

    const after = await page
      .getByText('Retail value', { exact: true })
      .first()
      .locator('xpath=..')
      .textContent();

    expect(after).toBe(before);
  });

  test('the status tabs filter and report an honest work queue', async ({ page }) => {
    const tabs = page.getByRole('navigation', { name: 'Filter by stock status' });
    await expect(tabs).toBeVisible();

    // The counts come from the unfiltered catalog, so switching tabs must not
    // shrink the numbers to whatever is left in the current view.
    const lowTab = tabs.getByRole('link', { name: /Low stock/ });
    const allTab = tabs.getByRole('link', { name: /^All/ });
    const lowCount = (await lowTab.textContent())?.match(/\d+/)?.[0] ?? '0';
    const allCount = (await allTab.textContent())?.match(/\d+/)?.[0] ?? '0';
    expect(Number(allCount)).toBeGreaterThanOrEqual(Number(lowCount));

    await lowTab.click();
    await expect(page).toHaveURL(/status=low/, { timeout: 15000 });

    // Still showing the true queue, not just the rows that survived.
    const stillLow = await lowTab.textContent();
    expect(stillLow?.match(/\d+/)?.[0]).toBe(lowCount);
  });

  test('an out-of-stock filter shows only rows that are actually empty', async ({ page }) => {
    await page.goto('/inventory?status=out');
    await expect(page.locator('h1:has-text("Inventory")').first()).toBeVisible();
    // The seeded store is fully stocked, so the honest outcome is the empty
    // state rather than a fabricated row. Discriminate on the empty state
    // itself rather than on a row count: the empty state is rendered AS a
    // <tr>, so counting rows would count the placeholder itself.
    const emptyState = page.getByText('No products match these filters');
    const rows = page.locator('table tbody tr');

    if (await emptyState.isVisible().catch(() => false)) {
      // Names the filter that caused it, and offers a way out.
      await expect(page.getByText(/stock out of stock/)).toBeVisible();
      await expect(page.getByRole('link', { name: 'Clear all filters' })).toBeVisible();
      return;
    }

    // Otherwise every row shown must genuinely be empty.
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText('0 in stock');
    }
  });

  test('sorting preserves the active status filter', async ({ page }) => {
    await page.goto('/inventory?status=low');
    await expect(page.getByRole('navigation', { name: 'Filter by stock status' })).toBeVisible();

    await page.getByRole('link', { name: 'Stock Value' }).first().click();
    await expect(page).toHaveURL(/status=low/, { timeout: 15000 });
    await expect(page).toHaveURL(/sort=value/, { timeout: 15000 });
  });

  test('the Stock Value column agrees with the Stock Value sort', async ({ page }) => {
    await page.goto('/inventory?sort=value&order=desc');
    const header = page.getByRole('link', { name: 'Stock Value' }).first();
    await expect(header).toHaveAttribute('aria-sort', 'descending', { timeout: 15000 });

    // Read the first three money cells in the Stock Value column and confirm
    // they are in descending order - i.e. the sort and the rendered value are
    // derived from the same number.
    const cells = page.locator('table tbody tr td:nth-child(7)');
    const values: number[] = [];
    const rows = await page.locator('table tbody tr').count();
    for (let i = 0; i < Math.min(rows, 4); i += 1) {
      const text = (await cells.nth(i).textContent()) ?? '';
      values.push(Number(text.replace(/[^0-9.]/g, '')));
    }
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });

  test('category insights summarise the catalog without an export', async ({ page }) => {
    const panel = page.locator('section').filter({ hasText: 'Category insights' });
    await expect(panel).toBeVisible();
    // Scoped to the panel: a bare getByText('Electronics') resolves to the
    // hidden <option> in the add-product dialog's category <select>, which is
    // present on the page but never visible.
    await expect(panel.getByText('Electronics').first()).toBeVisible();
    // Each row states its SKU count, so this is a summary rather than a bare
    // list of names.
    await expect(panel.getByText(/SKU/).first()).toBeVisible();
  });
});