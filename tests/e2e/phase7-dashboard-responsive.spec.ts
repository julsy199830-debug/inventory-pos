import { test, expect } from '@playwright/test';

/**
 * Phase 7 — the DASHBOARD at every supported viewport.
 *
 * The existing responsive specs cover the POS and the register at these sizes,
 * but nothing targeted the dashboard, which is the landing page for every
 * signed-in staff member. That left a specific unverified risk: the new quick
 * actions are a wrapping row of seven LABELLED buttons, and a labelled button
 * row is exactly what overflows a 390px phone.
 *
 * Overflow is asserted the way a user experiences it — by asking whether the
 * document is wider than the viewport — rather than by measuring one element.
 * Every check is a real visibility/layout assertion; there are no sleeps.
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

/**
 * True when the document scrolls sideways.
 *
 * `scrollWidth > clientWidth` on the root is the honest signal: a user on a
 * phone can swipe the whole page sideways when this is true. A single wide child
 * is often scrollable on purpose (a data table), so the root is what we measure
 * — and we report WHICH element is widest when it fails.
 */
async function horizontalOverflow(page: Page): Promise<{
  overflowing: boolean;
  detail: string;
}> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflowing = doc.scrollWidth > doc.clientWidth + 1;
    if (!overflowing) return { overflowing: false, detail: '' };
    const widest = Array.from(document.querySelectorAll('*'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName, right: Math.round(r.right) };
      })
      .sort((a, b) => b.right - a.right)[0];
    return {
      overflowing: true,
      detail: `scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth} widest=${widest?.tag} right=${widest?.right}`,
    };
  });
}
test.describe('Phase 7 — dashboard responsive', () => {
  for (const vp of VIEWPORTS) {
    test(`no horizontal overflow at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible({
        timeout: 25000,
      });
      const { overflowing, detail } = await horizontalOverflow(page);
      expect(overflowing, `page scrolls sideways at ${vp.name}: ${detail}`).toBe(false);
    });
  }

  for (const vp of VIEWPORTS) {
    test(`stays usable at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await login(page);
      await page.goto('/');

      await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible({
        timeout: 25000,
      });
      await expect(page.getByText(/^Hello, /).first()).toBeVisible();

      // Bounding boxes, not just visibility: an element scrolled off to the
      // right is technically "visible" but unreachable without sideways
      // scrolling, which is the failure this catches.
      const actions = page.getByTestId('dashboard-quick-actions');
      await expect(actions).toBeVisible({ timeout: 25000 });
      const links = actions.locator('a');
      const count = await links.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = await links.nth(i).boundingBox();
        expect(box, `quick action ${i} must be laid out`).not.toBeNull();
        expect(
          box!.x + box!.width,
          `quick action ${i} extends past the viewport at ${vp.name}`,
        ).toBeLessThanOrEqual(vp.width + 1);
        expect(box!.y + box!.height, `quick action ${i} has no height`).toBeGreaterThan(0);
      }

      await expect(page.getByText('Sales today', { exact: true }).first()).toBeVisible();
      const section = page.getByTestId('dashboard-needs-attention');
      if (await section.count()) {
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
      }
    });
  }

  test('quick actions wrap onto more than one row on a phone', async ({ page }) => {
    // The positive case: if the row did NOT wrap, the buttons would have to
    // overflow, which the overflow test already catches. This stops a future
    // "one row, smaller text" change from quietly making labels unreadable.
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/');
    const links = page.getByTestId('dashboard-quick-actions').locator('a');
    await expect(links.first()).toBeVisible({ timeout: 25000 });
    const count = await links.count();

    const tops = new Set<number>();
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      if (box) tops.add(Math.round(box.y));
    }
    expect(tops.size, 'the seven labelled actions must wrap on a 390px screen').toBeGreaterThan(1);
    expect((await links.first().innerText()).trim().length).toBeGreaterThan(3);
  });

  test('dashboard panels do not overlap each other', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await login(page);
    await page.goto('/');
    await expect(page.getByText('Sales trend', { exact: true }).first()).toBeVisible({
      timeout: 25000,
    });
    await expect(page.getByText('Activity by time', { exact: true }).first()).toBeVisible();

    // Overlap is the failure mode a stacked-at-this-width layout produces, and
    // it is completely invisible to a visibility assertion.
    const trend = await page.getByText('Sales trend', { exact: true }).first().boundingBox();
    const hours = await page.getByText('Activity by time', { exact: true }).first().boundingBox();
    if (trend && hours) {
      const overlapX =
        Math.min(trend.x + trend.width, hours.x + hours.width) - Math.max(trend.x, hours.x);
      const overlapY =
        Math.min(trend.y + trend.height, hours.y + hours.height) - Math.max(trend.y, hours.y);
      expect(overlapX > 0 && overlapY > 0, 'panels overlap').toBe(false);
    }
  });
});