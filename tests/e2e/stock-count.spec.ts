/**
 * Physical stock count — UI smoke test (Phase 1b).
 *
 * Covers the interaction contract of the count sheet, which the Server Action
 * tests (`tests/unit/stock-count.test.ts`) cannot see: that the dialog opens,
 * pre-fills every row with the system quantity, recomputes variance live as
 * the counter types, and refuses to submit while a cell is blank or malformed.
 *
 * RULES:
 *  - NO reseeding and NO writes. The sheet is never submitted, so the shared
 *    E2E database is left exactly as seeded — the apply path is covered by the
 *    unit suite against a throwaway database instead.
 *  - Runs under --workers=1 (suite standard).
 */
import { test, expect } from '@playwright/test';

async function adminLogin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
  await page.locator('button:has-text("Admin")').first().click();
  const pinInput = page.locator('input[type="password"]');
  await expect(pinInput).toBeEnabled({ timeout: 15000 });
  await pinInput.fill('1234');
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

test.describe('Physical stock count', () => {
  test('pre-fills the sheet, shows live variance, and blocks invalid input', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/inventory');
    await expect(page.getByRole('button', { name: 'Stock count' })).toBeVisible();

    // The trigger is a client island, so retry past hydration before failing.
    await expect(async () => {
      await page.getByRole('button', { name: 'Stock count' }).click();
      await expect(
        page.getByRole('dialog', { name: 'Physical stock count' }),
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    const dialog = page.getByRole('dialog', { name: 'Physical stock count' });
    await expect(dialog).toBeVisible();

    // Every row starts at the system quantity, so an untouched sheet has no
    // variances and the primary action is (correctly) inert.
    const counted = dialog.locator('input[type="number"]');
    expect(await counted.count()).toBeGreaterThan(0);
    const first = counted.first();
    await expect(first).not.toHaveValue('');
    await expect(dialog.getByRole('button', { name: /Nothing to apply/ })).toBeDisabled();

    // Typing an exception produces a live variance and enables Apply.
    await first.fill('999');
    await expect(dialog.getByText(/to adjust/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Apply 1 adjustment/ })).toBeEnabled();

    // A cleared cell must block submission rather than being read as zero.
    await counted.nth(1).fill('');
    await expect(dialog.getByRole('button', { name: /Apply/ })).toBeDisabled();
    await expect(dialog.getByText(/need a whole number/)).toBeVisible();

    // Restoring the value re-enables it, and the summary + Apply button stay
    // reachable while scrolling a long sheet.
    await counted.nth(1).fill('33');
    const applyBtn = dialog.getByRole('button', { name: /Apply 1 adjustment/ });
    await expect(applyBtn).toBeEnabled();
    await dialog.locator('tbody').last().scrollIntoViewIfNeeded();
    await expect(applyBtn).toBeInViewport();
  });
});
