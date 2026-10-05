import { test, expect } from '@playwright/test';

/**
 * Phase 6 E2E: global store settings.
 *
 * The claim under test was FALSE before Phase 6: the setting row had columns for
 * currency, tax and date format that NOTHING could change, and every screen
 * carried a private money formatter. So changing the store's currency was
 * impossible, and even if it had been possible most screens would have ignored
 * it.
 *
 * Isolation: this runs against the disposable `test-db/e2e.db` from the global
 * setup, never the real `dev.db`. Settings are GLOBAL, so every mutating test
 * restores the original values — a dirty setting would corrupt later specs.
 */

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };
const CASHIER = { button: 'button:has-text("Cashier")', pin: '0000' };

async function login(page: Page, who: typeof ADMIN | typeof CASHIER) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  const btn = page.locator(who.button).first();
  await expect(btn).toBeVisible({ timeout: 15000 });
  await btn.click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(who.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

/** Read the saved settings straight out of the settings form. */
async function readSettings(page: Page) {
  await page.goto('/settings');
  await expect(page.locator('#storeName')).toBeVisible({ timeout: 20000 });
  return {
    storeName: await page.locator('#storeName').inputValue(),
    currencySymbol: await page.locator('#currencySymbol').inputValue(),
    currencyCode: await page.locator('#currencyCode').inputValue(),
    locale: await page.locator('#locale').inputValue(),
    dateFormat: await page.locator('#dateFormat').inputValue(),
    timeFormat: await page.locator('#timeFormat').inputValue(),
    taxRate: await page.locator('#taxRate').inputValue(),
    taxEnabled: await page.locator('#taxEnabled').isChecked(),
    email: await page.locator('#email').inputValue(),
    receiptFooter: await page.locator('#receiptFooter').inputValue(),
  };
}

/**
 * Apply new settings and wait for the confirmation banner.
 *
 * The banner is the only reliable "saved" signal: the action revalidates twelve
 * routes, so the form's inputs can re-render from the server mid-save.
 */
async function saveSettings(page: Page, apply: () => Promise<void>) {
  // Navigate here rather than assuming the caller is already on /settings.
  // These tests navigate to other routes to verify propagation, and the `finally`
  // restore runs from wherever the test ended up — without this the restore
  // silently fails and leaves a mutated setting behind for the next spec.
  await page.goto('/settings');
  await expect(page.locator('#currencySymbol')).toBeVisible({ timeout: 20000 });
  await apply();
  await page.locator('button:has-text("Save settings")').click();
  await expect(
    page.locator('[role="status"]:has-text("Settings saved")'),
  ).toBeVisible({ timeout: 20000 });
}
// ── Load & save ───────────────────────────────────────────────────────────────

test.describe('Phase 6 — Store Settings', () => {
  test('settings load with the saved values and every Phase 6 field is editable', async ({
    page,
  }) => {
    await login(page, ADMIN);
    const s = await readSettings(page);

    // The regression that motivated the feature: these columns existed in the
    // database with no input bound to them.
    expect(s.storeName.length).toBeGreaterThan(0);
    expect(s.currencySymbol.length).toBeGreaterThan(0);
    expect(s.currencyCode).toMatch(/^[A-Z]{3}$/);
    expect(s.locale.length).toBeGreaterThan(0);
    expect(['MMM D, YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).toContain(
      s.dateFormat,
    );
    expect(['h:mm a', 'HH:mm']).toContain(s.timeFormat);
    expect(Number(s.taxRate)).toBeGreaterThanOrEqual(0);
  });

  test('a saved store name persists across a reload', async ({ page }) => {
    await login(page, ADMIN);
    const original = (await readSettings(page)).storeName;
    const renamed = `Phase6 Store ${Date.now().toString().slice(-5)}`;

    try {
      await saveSettings(page, () => page.locator('#storeName').fill(renamed));
      await page.reload();
      await expect(page.locator('#storeName')).toHaveValue(renamed, {
        timeout: 20000,
      });
    } finally {
      await saveSettings(page, () => page.locator('#storeName').fill(original));
    }
  });

  test('the configured date and time formats round-trip through the form', async ({
    page,
  }) => {
    await login(page, ADMIN);
    const original = await readSettings(page);

    // This deliberately tests the ROUND TRIP rather than counting <option>
    // elements. The dropdown is rendered from the same `DATE_FORMATS` /
    // `TIME_FORMATS` constants that `saveSettings` validates against, and every
    // pattern's actual output is already pinned by `tests/unit/format.test.ts`;
    // re-asserting the option count in E2E duplicated unit coverage while
    // depending on the select's internals.
    try {
      await saveSettings(page, async () => {
        await page.locator('#dateFormat').selectOption('YYYY-MM-DD');
        await page.locator('#timeFormat').selectOption('HH:mm');
      });

      const saved = await readSettings(page);
      expect(saved.dateFormat).toBe('YYYY-MM-DD');
      expect(saved.timeFormat).toBe('HH:mm');
    } finally {
      await saveSettings(page, async () => {
        await page
          .locator('#dateFormat')
          .selectOption(original.dateFormat as 'YYYY-MM-DD');
        await page
          .locator('#timeFormat')
          .selectOption(original.timeFormat as 'HH:mm');
      });
    }
  });

  test('the tax switch and rate round-trip through the form', async ({ page }) => {
    await login(page, ADMIN);
    const original = await readSettings(page);

    try {
      await saveSettings(page, async () => {
        await page.locator('#taxRate').fill('7.5');
        if (original.taxEnabled) await page.locator('#taxEnabled').uncheck();
      });
      const s = await readSettings(page);
      expect(Number(s.taxRate)).toBe(7.5);
      expect(s.taxEnabled).toBe(false);
    } finally {
      await saveSettings(page, async () => {
        await page.locator('#taxRate').fill(original.taxRate);
        if (original.taxEnabled) await page.locator('#taxEnabled').check();
      });
    }
  });
});
// ── Currency propagation ──────────────────────────────────────────────────────

/**
 * Each of these changes the symbol to a value that cannot occur by accident
 * ("RM") and asserts it reaches a different part of the app, then restores the
 * original. Together they are the proof that "Store Settings is global" is now
 * true rather than aspirational — before Phase 6 every one of these pages had a
 * private formatter and at least four ignored the setting entirely.
 */
test.describe('Phase 6 — currency propagates globally', () => {
  const CASES: { name: string; path: string }[] = [
    { name: 'the till', path: '/pos' },
    { name: 'inventory', path: '/inventory' },
    { name: 'the customers list', path: '/customers' },
    { name: 'the dashboard', path: '/' },
    { name: 'reports', path: '/reports' },
    { name: 'accounting', path: '/accounting' },
  ];

  for (const target of CASES) {
    test(`changing the currency symbol reaches ${target.name}`, async ({ page }) => {
      await login(page, ADMIN);
      const original = (await readSettings(page)).currencySymbol;

      try {
        await saveSettings(page, () =>
          page.locator('#currencySymbol').fill('RM'),
        );
        await page.goto(target.path);

        // Assert on an ACTUAL formatted money value, not a bare glyph.
        //
        // The earlier version used `page.locator('text=RM')`, which is an
        // EXACT-match locator in Playwright: it only matches an element whose
        // whole text is "RM". Money renders as "RM24.99", so no element ever
        // matched and the assertion could not pass however correct the app was.
        // A regex locator matches the rendered value itself.
        //
        // This also doubles as the wait condition — no arbitrary sleep: the
        // assertion retries until a real money element is on the page.
        const money = page.getByText(/RM[\d,]+\.\d{2}/).first();
        await expect(money).toBeVisible({ timeout: 30000 });
      } finally {
        await saveSettings(page, () =>
          page.locator('#currencySymbol').fill(original),
        );
      }
    });
  }

  test('historical sale amounts are unchanged by a currency change', async ({
    page,
  }) => {
    await login(page, ADMIN);
    const original = (await readSettings(page)).currencySymbol;

    // Read the dashboard's revenue total BEFORE the change. Formatting is
    // presentation only: the underlying recorded amount must not move.
    //
    // The first version drove the POS History modal and read a
    // `history-amount` element, which depended on an async facet fetch and a
    // specific modal interaction. Comparing the dashboard total is both more
    // stable and a stronger claim — it is a recorded, aggregated business
    // figure rather than one row.
    await page.goto('/');
    const total = page.getByText(/(?:₱|RM)[\d,]+\.\d{2}/).first();
    await expect(total).toBeVisible({ timeout: 30000 });
    const beforeText = (await total.textContent())!.trim();
    const beforeDigits = beforeText.replace(/^[^0-9.-]+/, '');
    expect(beforeDigits.length).toBeGreaterThan(0);

    try {
      await saveSettings(page, () =>
        page.locator('#currencySymbol').fill('RM'),
      );
      await page.goto('/');
      const after = page.getByText(/RM[\d,]+\.\d{2}/).first();
      await expect(after).toBeVisible({ timeout: 30000 });
      const afterDigits = ((await after.textContent())!.trim()).replace(
        /^[^0-9.-]+/,
        '',
      );

      // Identical digits, different glyph. This is the assertion that would
      // fail if a settings change ever rewrote a historical sale amount.
      expect(afterDigits).toBe(beforeDigits);
    } finally {
      await saveSettings(page, () =>
        page.locator('#currencySymbol').fill(original),
      );
    }
  });
});

// ── RBAC ──────────────────────────────────────────────────────────────────────

test.describe('Phase 6 — settings RBAC', () => {
  test('a CASHIER cannot reach the settings page', async ({ page }) => {
    await login(page, CASHIER);
    await page.goto('/settings');
    // The boundary is enforced on the page, not merely hidden in the UI.
    await expect(page).not.toHaveURL(/\/settings/, { timeout: 20000 });
  });

  test('an anonymous visitor is redirected to login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
  });
});