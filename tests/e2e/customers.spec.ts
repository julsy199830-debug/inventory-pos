import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { getE2EDatabasePath } from '../setup/e2e-database';

const customerName = `E2E Customer ${Date.now()}`;

test.afterAll(() => {
  const db = new Database(getE2EDatabasePath()) as unknown as {
    prepare(sql: string): { run(...args: unknown[]): unknown };
    close(): void;
  };
  try {
    db.prepare('DELETE FROM "Customer" WHERE name = ?').run(customerName);
  } finally {
    db.close();
  }
});

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

test.describe('Customers', () => {
  test('opens Add Customer, saves a customer, and lists it', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/customers');
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();

    await expect(async () => {
      await page.getByRole('button', { name: 'Add Customer' }).click();
      await expect(page.getByRole('heading', { name: 'Add Customer' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    await page.getByPlaceholder('Name *').fill(customerName);
    await page.getByPlaceholder('Phone', { exact: true }).fill('09171234567');
    await page.getByPlaceholder('Email', { exact: true }).fill('e2e.customer@example.test');
    await page.getByPlaceholder('Credit limit (0 = no credit)', { exact: true }).fill('1500');
    await page.getByRole('button', { name: 'Add Customer' }).last().click();

    await expect(page.getByRole('heading', { name: 'Add Customer' })).toBeHidden({ timeout: 15000 });
    await expect(page.locator('tr', { hasText: customerName })).toContainText('E2E Customer');
  });
});
