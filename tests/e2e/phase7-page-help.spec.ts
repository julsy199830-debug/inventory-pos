import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };
const CASHIER = { button: 'button:has-text("Cashier")', pin: '0000' };

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

// Every dialog open goes through this: server-rendered pages hydrate their
// client islands after first paint, so a click issued in that window is
// silently lost. Retrying the click until the dialog asserts keeps the suite
// deterministic on cold (webServer boot) and warm loads alike.
async function openHelp(page: Page, triggerTestId: string) {
  const trigger = page.getByTestId(triggerTestId);
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

test.describe('Phase 7 Step 6 — contextual page help', () => {
  test('first visit shows a New nudge but never auto-opens a dialog', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/suppliers');
    const trigger = page.getByTestId('page-help-trigger-suppliers');
    await expect(trigger).toBeVisible({ timeout: 15000 });
    // Non-blocking nudge: New dot present, but no dialog overlay.
    await expect(page.getByTestId('page-help-new-suppliers')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Page stays interactive — search box can be focused with no overlay in the way.
    await page.locator('input[type="search"], input[name="q"], input[placeholder*="Search" i]').first().click({ timeout: 10000 });
  });

  test('Got-it dismisses, clears the nudge, and persists across reload', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/suppliers');
    await openHelp(page, 'page-help-trigger-suppliers');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('About Suppliers');

    await page.getByTestId('page-help-got-it').click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    // Dismissing marks seen: nudge dot retires.
    await expect(page.getByTestId('page-help-new-suppliers')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('page-help-trigger-suppliers')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('page-help-new-suppliers')).toHaveCount(0);
  });

  test('trigger reopens after dismiss and Escape closes', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/inventory');
    await openHelp(page, 'page-help-trigger-inventory');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('About Products');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Reopenable at any time from the trigger.
    await openHelp(page, 'page-help-trigger-inventory');
    await expect(page.getByRole('dialog')).toContainText('About Products');
    await page.getByTestId('page-help-got-it').click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  });

  test('next-step link navigates and closes the panel', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/suppliers');
    await openHelp(page, 'page-help-trigger-suppliers');

    await page.getByTestId('page-help-next-step').click();
    await expect(page).toHaveURL(/\/purchasing/, { timeout: 15000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('POS compact trigger never blocks scan or checkout', async ({ page }) => {
    await signIn(page, CASHIER);
    await page.goto('/pos');
    // The register hydrates a large client tree; wait for a hydrated-only
    // marker (the catalog hint renders purely client-side) before touching
    // the search box, or the fill lands before filtering attaches.
    await expect(page.getByTestId('pos-catalog-hint')).toBeVisible({ timeout: 15000 });
    const trigger = page.getByTestId('page-help-trigger-pos');
    await expect(trigger).toBeVisible({ timeout: 15000 });
    // No auto-open over the register.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Catalog search stays usable with the trigger beside it.
    const search = page.locator('input[aria-label="Search or scan products"]');
    await expect(search).toBeVisible({ timeout: 15000 });
    await search.fill('xyzzy-no-match-qwerty-12345');
    // Wait for the filtered catalog to be empty: "No products found" message appears.
    await expect(page.getByText('No products found')).toBeVisible({ timeout: 10000 });
    await search.fill('');

    // Open + dismiss the compact help; cart flow remains reachable.
    await openHelp(page, 'page-help-trigger-pos');
    await expect(page.getByRole('dialog')).toContainText('How to make a sale');
    await page.getByTestId('page-help-got-it').click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 });
    await expect(search).toBeEnabled();
  });
});