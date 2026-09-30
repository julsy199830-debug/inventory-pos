/**
 * Phase 3 E2E: responsive behaviour of the daily workflow.
 *
 * The register is used on whatever is to hand - a desktop till, a laptop, a
 * tablet on the counter, sometimes a phone. The failure this guards against is
 * specifically HORIZONTAL OVERFLOW: a POS that scrolls sideways is unusable
 * with one hand, and on desktop a stray scrollbar means a panel is wider than
 * its column.
 *
 * Four viewports are checked across the pages a cashier actually opens, and
 * each asserts `scrollWidth <= clientWidth`. That is the real property, not a
 * proxy for it.
 *
 * The dialog check matters most: modals are the usual cause of overflow on a
 * phone, because a fixed-width panel plus padding overflows a 375px screen.
 */
import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };

/** Desktop till, laptop, tablet portrait, phone. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

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

/**
 * True when the document scrolls sideways.
 *
 * Measured on `documentElement` and `body` separately: an element that is
 * wider than the viewport can leave the body fine while the document still
 * scrolls, and vice versa, so both are checked.
 */
async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const docOverflow = doc.scrollWidth > doc.clientWidth + 1;
    const bodyOverflow = body.scrollWidth > doc.clientWidth + 1;
    return docOverflow || bodyOverflow;
  });
}

test.describe('Phase 3 - responsive layout', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}px): key pages do not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const [name, path, ready] of [
        ['dashboard', '/', 'h1:has-text("Dashboard")'],
        ['inventory', '/inventory', 'h1:has-text("Inventory")'],
        ['reports', '/reports', 'h1:has-text("Reports")'],
        // The catalog search is the one register control visible at EVERY
        // width. "Process Payment" is not: on a phone it lives inside the
        // closed cart drawer. That is correct behaviour, but it makes the
        // button useless as a readiness marker for a mobile check.
        ['register', '/pos', 'input[aria-label^="Search products"]'],
      ] as const) {
        await page.goto(path);
        await expect(page.locator(ready).first()).toBeVisible({ timeout: 25000 });
        // Let images/fonts settle; an unlaid-out image can briefly overflow.
        await page.waitForTimeout(250);
        expect(
          await hasHorizontalOverflow(page),
          `${name} at ${vp.width}px scrolls horizontally`,
        ).toBe(false);
      }
    });
  }

  test('the cart drawer opens without overflowing a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pos');
    await expect(
      page.locator('input[aria-label^="Search products"]').first(),
    ).toBeVisible({ timeout: 20000 });

    // Add something so the mobile summary bar and its View Cart button appear.
    const tile = page.locator('button[aria-label^="Add "]').first();
    await expect(async () => {
      await tile.click();
      await expect(page.getByRole('button', { name: /View Cart/ })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });

    await expect(async () => {
      await page.getByRole('button', { name: /View Cart/ }).click();
      await expect(page.locator('div[role="dialog"][aria-label="Current order"]')).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 20000 });

    expect(await hasHorizontalOverflow(page), 'cart drawer overflows the phone').toBe(false);

    // The drawer slides in, so its box must be polled rather than sampled once -
    // a read taken mid-animation sees it still mostly off-screen and reports a
    // false overflow.
    const width = page.viewportSize()?.width ?? 390;
    await expect
      .poll(
        async () => {
          const box = await page
            .locator('div[role="dialog"][aria-label="Current order"] > div')
            .last()
            .boundingBox();
          return box ? box.x + box.width : Number.POSITIVE_INFINITY;
        },
        { timeout: 10000 },
      )
      .toBeLessThanOrEqual(width + 1);
  });

  test('the history panel fits a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pos');
    const trigger = page.locator('button:has-text("Transactions")').first();
    await expect(trigger).toBeVisible({ timeout: 20000 });
    await expect(async () => {
      await trigger.click();
      await expect(
        page.locator('div[role="dialog"]:has(h2:has-text("Transactions"))'),
      ).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 25000 });

    expect(await hasHorizontalOverflow(page), 'history panel overflows the phone').toBe(false);
  });
});