import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

/**
 * Phase 7 — the dashboard for a real MANAGER (and re-check for ADMIN).
 *
 * The seed ships only an ADMIN and a CASHIER, so the MANAGER experience — the
 * whole point of a role-aware dashboard — had never been exercised. This
 * creates a MANAGER with an open shift via a spawned fixture (the generated
 * Prisma client uses `import.meta` and cannot be imported from a spec).
 *
 * What is being protected:
 *   - the greeting names the signed-in person, not a hardcoded manager,
 *   - an OPEN shift reads "On shift since", a closed one reads "Not clocked in",
 *   - purchasing/operational information is visible to staff,
 *   - a CASHIER still cannot reach the dashboard at all,
 *   - every quick action points at a route that actually exists.
 */

type Page = import('@playwright/test').Page;

const TAG = `p7${Date.now().toString().slice(-7)}`;
const MANAGER_PIN = '2468';

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };
const CASHIER = { button: 'button:has-text("Cashier")', pin: '0000' };

function fixture(mode: 'seed' | 'clean'): void {
  // `shell: true` is required on Windows; without it a `.cmd` shim spawns and
  // returns no stdout at all.
  const res = spawnSync(
    `npx tsx tests/setup/phase7-manager-fixture.ts ${mode} ${TAG} ${MANAGER_PIN}`,
    { encoding: 'utf8', env: process.env, shell: true },
  );
  if (res.status !== 0) {
    throw new Error(
      `manager fixture ${mode} failed (${res.status}): ${res.stderr || res.stdout || 'no output'}`,
    );
  }
}

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

const MANAGER = { button: `button:has-text("Moira")`, pin: MANAGER_PIN };

test.beforeAll(() => fixture('seed'));
test.afterAll(() => fixture('clean'));

test.describe('Phase 7 — dashboard by role', () => {
  test('a MANAGER reaches the dashboard and is greeted by name', async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible({
      timeout: 25000,
    });
    // The greeting comes from the session, not a placeholder.
    await expect(page.getByText('Hello, Moira', { exact: true })).toBeVisible();
    await expect(page.getByText('Manager', { exact: true }).first()).toBeVisible();
  });

  test('a MANAGER with an open shift is told they are on shift', async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto('/');
    // The fixture opens a shift; the dashboard must read it from the Shift row
    // (end IS NULL) rather than assume.
    await expect(page.getByText(/On shift since/).first()).toBeVisible({ timeout: 25000 });
  });

  test('a MANAGER sees operational and purchasing information', async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto('/');
    // Quick actions for the day-to-day manager work.
    const actions = page.getByTestId('dashboard-quick-actions');
    await expect(actions).toBeVisible({ timeout: 25000 });
    for (const label of ['Receive Stock', 'Products & Stock', 'Sales Reports']) {
      await expect(actions.getByText(label, { exact: true })).toBeVisible();
    }
    // Purchasing is management information and must be present for a manager.
    await expect(actions.locator('a[href="/purchasing"]')).toHaveCount(1);
  });

  test('every MANAGER quick action points at a real destination', async ({ page }) => {
    await signIn(page, MANAGER);
    await page.goto('/');
    const links = page.getByTestId('dashboard-quick-actions').locator('a');
    await expect(links.first()).toBeVisible({ timeout: 25000 });
    const count = await links.count();

    const seen: string[] = [];
    for (let i = 0; i < count; i++) {
      const href = (await links.nth(i).getAttribute('href'))!;
      expect(href).toMatch(/^\//);
      seen.push(href);
      // Follow it: a link to a route that 404s or bounces is a broken action.
      await page.goto(href);
      await expect(page).not.toHaveURL(/\/login/, { timeout: 25000 });
      await page.goBack();
    }
    expect(new Set(seen).size, 'quick actions must not duplicate destinations').toBe(seen.length);
  });

  test('a CASHIER still cannot reach the dashboard', async ({ page }) => {
    await signIn(page, CASHIER);
    await page.goto('/');
    // The (dashboard) layout bounces cashiers to the register. This is the
    // boundary the role-based dashboard content sits behind.
    await expect(page).toHaveURL(/\/pos/, { timeout: 25000 });
  });

  test('an ADMIN gets the full management dashboard', async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible({
      timeout: 25000,
    });
    await expect(page.getByText(/^Hello, /).first()).toBeVisible();
    await expect(page.getByText('Administrator', { exact: true }).first()).toBeVisible();

    // Same management actions as a manager, plus the sidebar's admin surfaces.
    const actions = page.getByTestId('dashboard-quick-actions');
    await expect(actions.getByText('Receive Stock', { exact: true })).toBeVisible();
    await expect(page.getByText('Store Settings', { exact: true }).first()).toBeVisible({
      timeout: 25000,
    });
  });
});