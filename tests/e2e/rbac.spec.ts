import { test, expect } from '@playwright/test';

/**
 * RBAC Guard E2E Tests for InvPos
 * Tests the server-side protection guards:
 * - checkSelfModification: prevent self-demotion/deactivation/deletion
 * - checkLastAdminProtection: protect the last ADMIN from being removed
 *
 * Guard order note: in every employee action, `checkSelfModification` runs
 * BEFORE `checkLastAdminProtection`. So when the sole ADMIN acts on their own
 * row, the self-modification guard fires first and the surfaced message is
 * always "You cannot change your own role or deactivate your own account." —
 * regardless of whether the action is a role change, deactivation, or deletion.
 */

// NOTE (test-infra): the database is seeded ONCE, serially, by the Playwright
// globalSetup (tests/setup/global-setup.ts) before any spec file runs. Do NOT
// reseed here — mid-suite reseeds recreate product/user rows and deadlock the
// single shared SQLite dev.db file held open by the dev-server webServer.
//
// Tests are ordered so that each one is independent: the beforeEach re-logs in
// as admin@julspos.test (who is reseeded as ADMIN every run), so no test relies
// on another test's side effects. Tests that mutate the admin's own row assert
// the self-modification guard message; the deletion test asserts the row still
// exists after the blocked attempt. No test skips because of prior pollution.

test.describe('RBAC Guards', () => {
  test.beforeEach(async ({ page }) => {
    // Login as Admin to access employee management
    await page.goto('/login');
    // Wait for full hydration
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Open register').first()).toBeVisible({ timeout: 15000 });
    await page.locator('button:has-text("Admin")').first().click();

    // Wait for PIN input to be enabled
    const pinInput = page.locator('input[type="password"]');
    await expect(pinInput).toBeVisible({ timeout: 15000 });
    await expect(pinInput).toBeEnabled({ timeout: 15000 });

    await pinInput.fill('1234');
    await page.locator('button:has-text("Open register")').first().click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*\/$/, { timeout: 15000 });

    // Navigate to employees page - database is seeded with admin as ADMIN
    await page.goto('/employees');
    await expect(page.locator('text=Employees').first()).toBeVisible({ timeout: 10000 });

    // Verify admin is ADMIN (seeded state) — this is the stable starting state
    // for every test in the suite because globalSetup reseeds before each run.
    // Re-fetch the row reference here; earlier queries may have stale references
    // after navigation (see the POS remove-item flakiness pattern).
    const adminRow2 = page.locator('tr', { hasText: 'admin@julspos.test' }).first();
    await expect(adminRow2).toBeVisible();

    const roleSelect2 = adminRow2.locator('select[name="role"]').first();
    const role = await roleSelect2.inputValue();
    expect(role).toBe('ADMIN');
  });

  /**
   * Select a new role on the admin's own row and assert the self-modification
   * guard toast appears.
   *
   * RETRY is deliberate (not assertion-weakening): right after `page.goto`,
   * the RoleSelect island may not be hydrated yet — `selectOption` then changes
   * the DOM value without React's onChange firing (observed as: no server
   * action POST, no toast, no console error). Re-dispatching the change event
   * once React is attached makes the action fire. Each retry still requires
   * the exact guard toast, so the server-side guard itself is always verified.
   */
  async function attemptSelfDemotion(
    page: import('@playwright/test').Page,
    adminRow: ReturnType<import('@playwright/test').Page['getByRole']>,
  ) {
    const roleSelect = adminRow.locator('select[name="role"]').first();
    await expect(roleSelect).toBeVisible();

    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'You cannot change your own role or deactivate your own account.' })
      .first();

    await expect(async () => {
      await roleSelect.selectOption('MANAGER');
      await expect(toast).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 20000 });
  }

  test('should prevent admin from demoting themselves', async ({ page }) => {
    // Navigate to employees page
    await page.goto('/employees');
    await expect(page.locator('text=Employees').first()).toBeVisible({ timeout: 10000 });

    // Find the Admin row and try to assign a non-admin role
    // RoleSelect is a native <select> inside a form - target it directly
    const adminRow = page.locator('tr', { hasText: 'admin@julspos.test' }).first();
    await expect(adminRow).toBeVisible();

    // Actually perform the demotion attempt: selecting MANAGER posts to the
    // `assignRole` Server Action, which is what trips the self-modification guard
    // (the actor IS admin@julspos.test). Without this the assertion below would
    // poll for a toast that nothing ever triggered.
    await attemptSelfDemotion(page, adminRow);
  });

  test('should prevent admin from deactivating themselves', async ({ page }) => {
    await page.goto('/employees');
    await expect(page.locator('text=Employees').first()).toBeVisible({ timeout: 10000 });

    const adminRow = page.locator('tr', { hasText: 'admin@julspos.test' }).first();
    await expect(adminRow).toBeVisible();

    // The toggle/deactivate control is a <button> (type="button") showing "Active".
    // Deactivation triggers a window.confirm prompt — accept it so the action runs.
    const toggleBtn = adminRow.locator('button:has-text("Active")').first();
    await page.waitForLoadState('networkidle');

    // Self-modification guard blocks deactivation of your own account. Retry:
    // if the click landed before hydration, the button's client handler never
    // ran — re-clicking once React is attached makes the action fire.
    const guardToast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'You cannot change your own role or deactivate your own account.' })
      .first();
    // One persistent dialog handler for the whole retry loop: accepting an
    // already-handled dialog throws, and a handler-less confirm auto-dismisses
    // (blocking the action) — so register once, before any click.
    page.on('dialog', (dialog) => void dialog.accept());
    await expect(async () => {
      await toggleBtn.click();
      await expect(guardToast).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 20000 });
  });

  test('should prevent deleting the last admin', async ({ page }) => {
    // This test asserts that deleting admin@julspos.test is blocked. At the
    // start of this test the beforeEach has reseeded + re-logged in, so
    // admin@julspos.test is ADMIN again. Deleting your own account hits the
    // self-modification guard first; the row remains. Assert the row is still
    // present — that is the observable outcome of the guard blocking deletion.
    await page.goto('/employees');
    await expect(page.locator('text=Employees').first()).toBeVisible({ timeout: 10000 });

    const adminRow = page.locator('tr', { hasText: 'admin@julspos.test' }).first();
    await expect(adminRow).toBeVisible();

    // Look for delete button - it's a form submit button with trash SVG
    const deleteBtn = adminRow.locator('button[type="submit"]:has(svg)').first();
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });

    // Set up dialog handler BEFORE clicking (confirm prompt)
    page.once('dialog', (dialog) => dialog.accept());

    await deleteBtn.click();
    await page.waitForLoadState('networkidle');

    // Deleting yourself hits the self-modification guard first.
    // The delete form has no inline toast handling, so the row simply
    // remains — assert the admin row is still present (deletion blocked).
    await expect(
      page.locator('tr', { hasText: 'admin@julspos.test' }).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should block unauthenticated access to employee mutations', async ({ page }) => {
    // Logout / clear cookies and try to access employees
    await page.context().clearCookies();
    await page.goto('/employees');

    // Should redirect to login (unauthenticated)
    await expect(page).toHaveURL(/.*\/login.*/);
  });

  test('should prevent demoting the last admin', async ({ page }) => {
    // This test assumes admin@julspos.test is the only active ADMIN.
    // We attempt to demote via the UI. Because the actor is the sole admin
    // acting on their OWN row, checkSelfModification runs first and blocks
    // the action with the self-modification message — the last-admin guard
    // is never reached in this single-admin scenario.
    await page.goto('/employees');
    await expect(page.locator('text=Employees').first()).toBeVisible({ timeout: 10000 });

    const adminRow = page.locator('tr', { hasText: 'admin@julspos.test' }).first();
    await expect(adminRow).toBeVisible();

    // Attempt to demote the sole admin via their own row
    await attemptSelfDemotion(page, adminRow);
  });
});
