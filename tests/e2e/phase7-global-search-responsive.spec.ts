import { test, expect } from '@playwright/test';

/**
 * Phase 7 Step 5 — the search dialog at every supported viewport.
 *
 * The dialog is a centered fixed overlay (max-w-xl, 85dvh scroll region), so
 * the risk is not page-level sideways scroll but the PANEL itself overflowing
 * a phone: trigger reachable, input usable, rows tappable, no sideways swipe
 * inside the dialog.
 */

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };

const VIEWPORTS = [
  { name: 'desktop 1440x900', width: 1440, height: 900 },
  { name: 'laptop 1280x720', width: 1280, height: 720 },
  { name: 'small laptop 1024x768', width: 1024, height: 768 },
  { name: 'tablet 834x1194', width: 834, height: 1194 },
  { name: 'phone 390x844', width: 390, height: 844 },
] as const;

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator(ADMIN.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(ADMIN.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

test.describe('Phase 7 Step 5 — search responsive', () => {
  for (const vp of VIEWPORTS) {
    test(`search opens and answers at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page);
      await page.goto('/');
      const trigger = page.locator('[data-testid="global-search-trigger"][data-hydrated="true"]:visible');
      await expect(trigger).toBeVisible({ timeout: 25000 });
      // Reachable: the whole trigger box sits inside the viewport.
      const box = await trigger.boundingBox();
      expect(box, 'search trigger must have a box').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);

      await trigger.click();
      const dialog = page.getByTestId('global-search-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      // The dialog never scrolls sideways at any size.
      const sideways = await page.evaluate(() => {
        const dlg = document.querySelector('[data-testid="global-search-dialog"]');
        if (!dlg) return { overflow: true, detail: 'dialog missing' };
        const panel = dlg.querySelector('.max-w-xl');
        const r = (panel ?? dlg).getBoundingClientRect();
        return {
          overflow: r.left < -1 || r.right > window.innerWidth + 1,
          detail: `left=${Math.round(r.left)} right=${Math.round(r.right)} inner=${window.innerWidth}`,
        };
      });
      expect(sideways.overflow, `dialog overflows at ${vp.name}: ${sideways.detail}`).toBe(false);

      // It answers, and the first answer is a comfortable touch target.
      await page.getByTestId('global-search-input').fill('inventory');
      const first = page.getByTestId('global-search-option').first();
      await expect(first).toBeVisible({ timeout: 15000 });
      const row = await first.boundingBox();
      expect(row, 'first result must have a box').not.toBeNull();
      expect(row!.height, 'result rows must stay tappable').toBeGreaterThanOrEqual(44);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 10000 });
    });
  }
});
