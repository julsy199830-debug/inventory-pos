/**
 * Phase 7, Section 3 step 2: the register header tells the truth.
 *
 * Two things were wrong with the old header, and each gets an assertion:
 *
 *   1. "Register #1 · Online" was a HARDCODED, always-green claim nobody ever
 *      checked — decoration masquerading as status. It is gone, and the badge
 *      it replaced carries the shift state the status strip already reads from
 *      `getRegisterStatus`. The core assertion here is that the header and the
 *      strip agree on `data-on-clock`: one read, one writer, so two panels can
 *      never report contradictory facts about the same shift.
 *
 *   2. The till showed the current time NOWHERE. A cashier manages breaks and
 *      their finish time by the clock, so the header now carries one.
 *
 * The agreement check runs on the ATTRIBUTE, not on label text: it must
 * survive a copy change, because the property that matters is "both surfaces
 * say the same state", not how either phrases it.
 */
import { test, expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };

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
  await page.goto('/pos');
  await expect(page.locator('text=Process Payment').first()).toBeVisible({ timeout: 20000 });
  // The strip's readiness flag. The header badge is published by the SAME read
  // that flips this flag, so once it is true the badge must be on screen too.
  await expect(page.locator('[data-register-loaded="true"]')).toBeVisible({ timeout: 25000 });
}

/** Drive the till to "off the clock", however it was found — and prove the header followed. */
async function ensureOffClock(page: Page) {
  const strip = page.getByTestId('shift-state');
  if ((await strip.getAttribute('data-on-clock')) === 'true') {
    // Retried, not clicked once: the button is server-rendered and clickable a
    // moment before React attaches its onClick, and a click in that window is
    // silently dropped — the same reason `phase4-pos` retries its punches.
    await expect(async () => {
      await page.locator('button:has-text("End shift")').first().click();
      await expect(strip).toHaveAttribute('data-on-clock', 'false', { timeout: 2000 });
    }).toPass({ timeout: 25000 });
  }
  await expect(page.getByTestId('header-shift-state')).toHaveAttribute('data-on-clock', 'false', {
    timeout: 20000,
  });
}

test.describe('Phase 7 - register header', () => {
  // ≥ sm, so the clock (which hides below that breakpoint by design) is in view.
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the header badge and the status strip report the same shift state', async ({ page }) => {
    const strip = page.getByTestId('shift-state');
    const badge = page.getByTestId('header-shift-state');

    // Published by the same read that flips `data-register-loaded`, so by now
    // it must be on screen — an absent badge means the header is not wired.
    await expect(badge).toBeVisible({ timeout: 20000 });

    const stripState = await strip.getAttribute('data-on-clock');
    expect(stripState).toMatch(/true|false/);
    // The whole point of the shared store: identical state, both surfaces.
    await expect(badge).toHaveAttribute('data-on-clock', stripState!);
  });

  test('the header no longer claims a hardcoded "Online" state', async ({ page }) => {
    await expect(page.locator('header')).not.toContainText('Online');
    await expect(page.locator('header')).not.toContainText('Register #1');
  });

  test('the till shows the current time', async ({ page }) => {
    const clock = page.locator('header time');
    await expect(clock).toBeVisible({ timeout: 20000 });
    await expect(clock).toHaveText(/\d{1,2}:\d{2}/);
  });

  test('clocking in and out moves the header badge along with the strip', async ({ page }) => {
    await ensureOffClock(page);

    // Punch IN — the badge must flip without a reload: it is fed by the same
    // post-punch read the strip performs.
    await expect(async () => {
      await page.locator('button:has-text("Start shift")').first().click();
      await expect(page.getByTestId('shift-state')).toHaveAttribute('data-on-clock', 'true', {
        timeout: 2000,
      });
    }).toPass({ timeout: 25000 });
    const onBadge = page.getByTestId('header-shift-state');
    await expect(onBadge).toHaveAttribute('data-on-clock', 'true', { timeout: 20000 });
    await expect(onBadge).toHaveText('On shift');
    await expect(onBadge).toHaveAttribute('data-on-break', 'false');

    // Punch OUT — and back to "Off shift" in words, not just an attribute.
    await expect(async () => {
      await page.locator('button:has-text("End shift")').first().click();
      await expect(page.getByTestId('shift-state')).toHaveAttribute('data-on-clock', 'false', {
        timeout: 2000,
      });
    }).toPass({ timeout: 25000 });
    await expect(onBadge).toHaveAttribute('data-on-clock', 'false', { timeout: 20000 });
    await expect(onBadge).toHaveText('Off shift');
  });
});
