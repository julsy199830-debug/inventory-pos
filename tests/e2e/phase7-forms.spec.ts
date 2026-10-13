import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };

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

// Server-rendered client islands hydrate after first paint; a click issued in
// that window is silently lost. Retry the click until the dialog asserts so the
// suite stays deterministic on cold (webServer boot) and warm loads alike.
async function openDialog(page: Page, triggerText: string) {
  // `.first()` guards against name collisions with a same-labelled submit
  // button (e.g. the customer form's "Add Customer" trigger + save action).
  const trigger = page.getByRole('button', { name: triggerText }).first();
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

test.describe('Phase 7 Step 7 — beginner-friendly forms & validation', () => {
  test('Add Product dialog groups fields into explained sections', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/inventory');
    await openDialog(page, 'Add New Product');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Add an item to the catalog so it can be sold at the register.');

    // Plain-language section groupings.
    await expect(dialog.getByRole('heading', { name: 'Details' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Pricing & stock' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Photo' })).toBeVisible();

    // Per-field hints that explain what the field is for.
    await expect(dialog.getByText('Must be unique - this is the code you scan or type at the till.')).toBeVisible();
    await expect(dialog.getByText('What the customer pays.')).toBeVisible();
    await expect(dialog.getByText('Units on hand right now.')).toBeVisible();

    // Required fields are marked, and both a cancel and a clear save action exist.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save product' })).toBeVisible();
  });

  test('empty product fields are blocked client-side before any save', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/inventory');
    await openDialog(page, 'Add New Product');

    const dialog = page.getByRole('dialog');
    // Required + min=0 attributes make the browser block the empty submit, so
    // the dialog neither closes nor shows a server error.
    await dialog.getByRole('button', { name: 'Save product' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  });

  test('duplicate SKU is rejected by the server and explains itself in the dialog', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/inventory');
    await openDialog(page, 'Add New Product');

    const dialog = page.getByRole('dialog');
    // ELEC-0001 is a stable seeded SKU; the server rejects the duplicate without
    // creating a record, so this proves server-authoritative validation.
    await dialog.locator('#name').fill('Duplicate probe');
    await dialog.locator('#sku').fill('ELEC-0001');
    await dialog.locator('#price').fill('100');
    await dialog.locator('#cost').fill('50');
    await dialog.locator('#stock').fill('5');
    await dialog.getByRole('button', { name: 'Save product' }).click();

    const error = dialog.getByRole('alert');
    await expect(error).toBeVisible({ timeout: 10000 });
    await expect(error).toContainText('already exists');
    // The dialog stays open so the user can fix the SKU rather than lose input.
    await expect(dialog).toBeVisible();
  });

  test('Add Supplier dialog explains optional contact fields', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/suppliers');
    await openDialog(page, 'Add New Supplier');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Track a vendor you purchase stock from.');
    await expect(dialog.getByText('Optional - the person you email or call about orders.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save supplier' })).toBeVisible();
  });

  test('Add Customer dialog explains email and credit-limit fields', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/customers');
    await openDialog(page, 'Add Customer');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Optional — leave blank if they have none.')).toBeVisible();
    await expect(dialog.getByText('The most this customer may owe on credit. 0 = no credit sales.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add Customer' })).toBeVisible();
  });
});
