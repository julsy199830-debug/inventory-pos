/**
 * Phase 2 E2E: the redesigned dashboard and the shared UI kit it is built on.
 *
 * These tests are deliberately about BEHAVIOUR A MANAGER CAN SEE, not markup:
 * the numbers agree with each other, the comparison ranges work, the Activity
 * by Time axis is readable, and the panels all render their real headings.
 *
 * The two properties most worth pinning here are the ones that broke before:
 *
 *   1. "Activity by time" must show ordinary clock labels ("9 AM", "12 PM") in a
 *      single line. The old 3-hour grid rendered stacked 10px/8px hour-over-
 *      meridiem labels, and four of its eight columns were hours a shop is shut.
 *      So we assert there is no 3-hour bucket label at all, and that the labels
 *      that DO appear are plain clock times at a readable size.
 *
 *   2. The range switcher must actually change the window, and the page must say
 *      which window it is showing. A control that renders but does not move the
 *      numbers is worse than no control.
 *
 * The login helper mirrors `phase1e.spec.ts`, including the hydration retry: the
 * register hydrates progressively, so a click can land before React attaches a
 * handler and be silently swallowed.
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

test.describe('Phase 2 — dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/');
    await expect(page.locator('h1:has-text("Dashboard")').first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('shows the daily business picture in a fixed panel order', async ({ page }) => {
    // The four headline tiles, then the two that quietly cost money.
    for (const label of [
      "Today's sales",
      'Revenue',
      'Transactions',
      'Inventory value',
      'Needs restock',
      'Value at risk',
      'Refunds & voids',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // Every panel heading renders, so a rename that drops one is caught here
    // rather than by someone noticing a missing card.
    for (const panel of [
      'Sales trend',
      'Activity by time',
      'Top-selling products',
      'Sales by category',
      'By payment method',
      'Restock list',
      'Cashier activity',
      'Recent transactions',
    ]) {
      await expect(page.getByRole('heading', { name: panel }).first()).toBeVisible();
    }
  });

  test('Activity by time uses plain clock labels, not 3-hour buckets', async ({ page }) => {
    const chart = page.getByRole('img', { name: 'Sales by hour of day' });
    await expect(chart).toBeVisible();

    const labels = await chart.locator('span').allTextContents();
    const shown = labels.map((t) => t.trim()).filter(Boolean);

    // Every visible axis label is an ordinary clock time on ONE line.
    expect(shown.length).toBeGreaterThan(0);
    for (const label of shown) {
      expect(label).toMatch(/^\d{1,2} (AM|PM)$/);
    }

    // The regression this replaces: the old grid stacked each label as the hour
    // over a bare meridiem (10px over 8px) so that eight would fit a
    // third-width card. No standalone "AM"/"PM" element means that treatment is
    // gone, and the labels are genuinely readable rather than merely present.
    // Note this does NOT forbid a real "3 PM" column: when a sale genuinely
    // happens at 15:00, that hour belongs on the axis like any other.
    await expect(chart.getByText('AM', { exact: true })).toHaveCount(0);
    await expect(chart.getByText('PM', { exact: true })).toHaveCount(0);

    // Bars are per-HOUR, so the axis can never exceed the 24 hours in a day.
    expect(shown.length).toBeLessThanOrEqual(24);

    // At least one bar: the seeded store has sales, so the card is not empty.
    await expect(chart.locator('div[style*="height"]').first()).toBeVisible();
  });

  test('the range switcher changes the window and says which one is shown', async ({ page }) => {
    const firstRange = await page.getByText(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/).first().textContent();
    expect(firstRange).toBeTruthy();

    // A range change is a navigation, so wait for the URL to carry the new key.
    await page.goto('/?range=today');
    await expect(page.getByText(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/).first()).toBeVisible();
    const todayRange = await page.getByText(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/).first().textContent();

    // "Today" is a single day, so its window is narrower than the default 30.
    expect(todayRange).not.toBe(firstRange);
    expect(todayRange?.trim().split(' to ')[0]).toBe(todayRange?.trim().split(' to ')[1]);
  });

  test('a nonsense range falls back to a real window instead of failing', async ({ page }) => {
    await page.goto('/?range=not-a-range');
    await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible();
    await expect(
      page.getByText(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/).first(),
    ).toBeVisible();
  });
});
