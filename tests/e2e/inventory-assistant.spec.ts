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

test.describe('Inventory Assistant', () => {
  test('shows current stock alerts and links to inventory', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/');

    const trigger = page.getByRole('button', { name: 'Open inventory assistant' });
    await expect(trigger).toBeVisible();
    await expect(async () => {
      await trigger.click();
      await expect(page.getByRole('dialog', { name: 'Inventory Assistant' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    const panel = page.getByRole('dialog', { name: 'Inventory Assistant' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Inventory Assistant')).toBeVisible();
    await expect(panel.getByText(/running low|out of stock/)).toBeVisible();
    await expect(panel.getByRole('link', { name: 'View Inventory' })).toBeVisible();
    await panel.getByRole('link', { name: 'View Inventory' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
  });
});
