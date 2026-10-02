import { test, expect } from '@playwright/test';

/**
 * Phase 5 E2E: time & attendance (DTR).
 *
 * Phase 5 added two pages over the `Shift` / `ShiftBreak` / `DtrCorrection`
 * tables, and this covers the three contracts a person actually relies on:
 *
 *   1. SELF-SERVICE (`/my-activity`) - a cashier, who is bounced out of every
 *      management route, can clock in, take an unpaid break and clock out, and
 *      can see their own record. The break rule is the interesting one: an
 *      OPEN break is unpaid time still accruing, so clocking out mid-break is
 *      refused *with the reason named* rather than silently.
 *   2. VISIBILITY (`/dtr`) - a manager sees every shift in a window with its
 *      worked time net of unpaid breaks. The window rides on `searchParams`, so
 *      a window that genuinely contains nothing must say so instead of quietly
 *      widening itself back to the default.
 *   3. CORRECTION (`/dtr`) - repairing a wrong punch. The reason is the whole
 *      point, so the test that matters here is the one that tries to correct a
 *      punch with NO reason and proves the write was refused; the happy path
 *      additionally asserts the correction is attributed and visible to the
 *      employee it was made about.
 *
 * Everything is asserted through the UI a person uses. The one place this file
 * reaches past the UI is the missing-reason case: the dialog marks its textarea
 * `required`/`minLength`, so the BROWSER would block an empty submit and the
 * Server Action that actually guards the write would never run. Stripping those
 * attributes is deliberate - it forces the request a hand-crafted POST would
 * send, and tests the layer that matters instead of the browser's validation.
 *
 * Test-infra note: the database is seeded ONCE by the Playwright globalSetup.
 * These tests therefore CREATE state rather than assume it - `resetCashier`
 * drives the cashier to a known off-the-clock, not-on-break state. Leaving an
 * open break behind would disable the "End shift" button in the Phase 4 register
 * specs, so that cleanup is not optional.
 */

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };
const CASHIER = { button: 'button:has-text("Cashier")', pin: '0000' };

/** Desktop till, laptop, tablet portrait, phone. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

/** Sign in from the picker, and confirm we landed where that role belongs. */
async function login(
  page: Page,
  who: typeof ADMIN | typeof CASHIER,
  landOnPos: boolean,
) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=Open register').first()).toBeVisible({
    timeout: 15000,
  });
  await page.locator(who.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(who.pin);
  await page.locator('button:has-text("Open register")').first().click();
  if (landOnPos) {
    await expect(page).toHaveURL(/\/pos/, { timeout: 15000 });
  } else {
    await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
  }
}

/** Open the employee's own record, outside the dashboard shell. */
async function openMyActivity(page: Page) {
  await page.goto('/my-activity');
  // The page's label is "My hours" (the cashier's words); the route keeps the
  // historical /my-activity path.
  await expect(page.getByText('My hours')).toBeVisible({ timeout: 20000 });
}

/**
 * Click a Server-Action button until `expectation` passes.
 *
 * Retried rather than clicked once, for the reason the other specs document:
 * these buttons are in the server HTML and clickable before React attaches its
 * onClick, so a click issued in that window is silently dropped - which looks
 * exactly like a server that ignored the request.
 */
async function clickUntil(
  page: Page,
  button: Locator,
  expectation: () => Promise<void>,
) {
  await expect(async () => {
    await button.click();
    await expectation();
  }).toPass({ timeout: 30000 });
}

/** Drive the cashier to a known state: off the clock, and not on break. */
async function resetCashier(page: Page) {
  await openMyActivity(page);
  const endBreak = page.getByRole('button', { name: 'End Break', exact: true });
  if (await endBreak.isVisible()) {
    await clickUntil(page, endBreak, () =>
      expect(page.getByText(/On the clock since/)).toBeVisible(),
    );
  }
  const clockOut = page.getByRole('button', { name: 'Clock Out', exact: true });
  if (await clockOut.isVisible()) {
    await clickUntil(page, clockOut, () =>
      expect(page.getByText('Off the clock')).toBeVisible(),
    );
  }
  await expect(page.getByText('Off the clock')).toBeVisible({ timeout: 20000 });
}

/**
 * Open the correction dialog for a DTR row.
 *
 * The `Correct` button is server-rendered and clickable before React attaches
 * its onClick, so a click issued in that window opens nothing - which looks
 * exactly like a broken dialog. Retried until the dialog actually appears.
 */
async function openCorrectionDialog(page: Page, row: Locator): Promise<Locator> {
  await clickUntil(page, row.getByRole('button', { name: 'Correct' }), async () => {
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
  });
  return page.getByRole('dialog');
}

/**
 * Make sure THIS user has at least one shift row on record, so the DTR table
 * has a row to correct.
 *
 * Created rather than assumed: the seeded database ships no shifts, and other
 * specs clock the Admin in and out, so the row may or may not already be there.
 * An open shift already counts as a row, so "on the clock" needs nothing.
 */
async function ensureShiftOnRecord(page: Page) {
  await openMyActivity(page);
  const rows = await page
    .getByText(/\d+ most recent/)
    .first()
    .innerText()
    .then((text) => Number(text.match(/(\d+)\s+most recent/)?.[1] ?? '0'));
  if (rows > 0) return;

  await clickUntil(
    page,
    page.getByRole('button', { name: 'Clock In', exact: true }),
    () => expect(page.getByText(/On the clock since/)).toBeVisible(),
  );
  await clickUntil(
    page,
    page.getByRole('button', { name: 'Clock Out', exact: true }),
    () => expect(page.getByText('Off the clock')).toBeVisible(),
  );
}

/** "YYYY-MM-DDTHH:MM" in the browser's zone - what a `datetime-local` takes. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * True when the document scrolls sideways.
 *
 * Measured on `documentElement` and `body` separately: an element wider than
 * the viewport can leave the body fine while the document still scrolls.
 */
async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return (
      doc.scrollWidth > doc.clientWidth + 1 ||
      body.scrollWidth > doc.clientWidth + 1
    );
  });
}
test.describe('Phase 5 - my own attendance', () => {
  // Every test in this block ends at "off the clock": an open shift left behind
  // would show up as a phantom row on /dtr and a phantom "on the clock" on the
  // register, so the state is restored rather than assumed either way.
  test.afterEach(async ({ page }) => {
    await resetCashier(page);
  });

  test('a cashier can reach their own record, which no management route allows', async ({
    page,
  }) => {
    await login(page, CASHIER, true);

    // The same cashier is bounced off /dtr - the layout sends CASHIERs to the
    // till before the page ever renders...
    await page.goto('/dtr');
    await expect(page).toHaveURL(/\/pos/, { timeout: 20000 });

    // ...and served their own hours instead.
    await openMyActivity(page);
    await expect(page.getByText('Off the clock')).toBeVisible();
    await expect(
      page.getByText('Clock in to start recording your day.'),
    ).toBeVisible();
    // No correction control here: editing your own attendance is exactly what
    // the reason-required manager flow exists to police.
    await expect(page.getByRole('button', { name: 'Correct' })).toHaveCount(0);
  });

  test('clocking in records the start, and clocking out files the day', async ({
    page,
  }) => {
    await login(page, CASHIER, true);
    await resetCashier(page);

    await clickUntil(
      page,
      page.getByRole('button', { name: 'Clock In', exact: true }),
      () => expect(page.getByText(/On the clock since/)).toBeVisible(),
    );
    // Punching in exposes the controls that only make sense on shift, and the
    // recorded start is now a row on the page rather than a session flag.
    await expect(
      page.getByRole('button', { name: 'Clock Out', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Start Break', exact: true }),
    ).toBeVisible();
    // The open shift is flagged in the list, and totalled.
    await expect(page.getByText('open').first()).toBeVisible();

    await clickUntil(
      page,
      page.getByRole('button', { name: 'Clock Out', exact: true }),
      () => expect(page.getByText('Off the clock')).toBeVisible(),
    );

    // The shift is now closed history, with a worked total against it.
    const shift = page.locator('li').filter({ hasText: / – / }).first();
    await expect(shift).toBeVisible();
    await expect(shift).toContainText('m');
  });

  test('a break is unpaid, and clocking out during one is refused by name', async ({
    page,
  }) => {
    await login(page, CASHIER, true);
    await resetCashier(page);

    await clickUntil(
      page,
      page.getByRole('button', { name: 'Clock In', exact: true }),
      () => expect(page.getByText(/On the clock since/)).toBeVisible(),
    );
    await clickUntil(
      page,
      page.getByRole('button', { name: 'Start Break', exact: true }),
      () => expect(page.getByText(/On break since/)).toBeVisible(),
    );

    // The rule is stated before it is hit, not discovered by failing.
    await expect(page.getByText(/Break time is unpaid/)).toBeVisible();

    // The attempt itself: refused, and it says WHY.
    await page.getByRole('button', { name: 'Clock Out', exact: true }).click();
    await expect(
      page.getByText(
        "You're still on break. End your break before clocking out.",
      ),
    ).toBeVisible({ timeout: 20000 });
    // Refused means still on break - the shift was not silently closed.
    await expect(page.getByText(/On break since/)).toBeVisible();

    // Ending the break unlocks the clock-out that was just refused.
    await clickUntil(
      page,
      page.getByRole('button', { name: 'End Break', exact: true }),
      () => expect(page.getByText(/On the clock since/)).toBeVisible(),
    );
    await expect(page.getByText(/Break time is unpaid/)).toHaveCount(0);
  });
});
test.describe('Phase 5 - the manager DTR', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN, false);
  });

  test('the DTR lists a shift with its punches and worked time', async ({ page }) => {
    await ensureShiftOnRecord(page);
    await page.goto('/dtr');

    await expect(
      page.getByRole('heading', { name: 'Time & attendance' }),
    ).toBeVisible({ timeout: 20000 });
    // Worked time is a derived figure, not a stored one, so the page states
    // the accounting rule next to the number it produced.
    await expect(
      page.getByText('Worked time = clock span minus unpaid breaks.'),
    ).toBeVisible();

    const row = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Correct' })).toBeVisible();
    // The columns a manager reconciles a shift against.
    for (const heading of ['Employee', 'Clock in', 'Clock out', 'Breaks', 'Worked']) {
      await expect(page.getByRole('columnheader', { name: heading })).toBeVisible();
    }
  });

  test('an empty window says so instead of falling back to the default', async ({
    page,
  }) => {
    await ensureShiftOnRecord(page);
    await page.goto('/dtr');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    // A window in the past, far enough that no shift can fall in it. The filter
    // is a GET form, so the applied window is also visible in the URL.
    await page.fill('input[name="from"]', '2001-01-01');
    await page.fill('input[name="to"]', '2001-01-02');
    await page.locator('button:has-text("Apply")').click();
    await expect(page).toHaveURL(/from=2001-01-01/, { timeout: 20000 });

    await expect(page.getByText('No shifts in this window.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByText('No corrections in this window.')).toBeVisible();
  });

  test('a correction without a reason is refused, and nothing is written', async ({
    page,
  }) => {
    await ensureShiftOnRecord(page);
    await page.goto('/dtr');
    const row = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await expect(row).toBeVisible({ timeout: 20000 });

    const dialog = await openCorrectionDialog(page, row);

    // Move the punch somewhere real, so the ONLY thing that can stop this
    // write is the missing reason.
    await dialog
      .locator('input[name="value"]')
      .fill(toDatetimeLocal(new Date(Date.now() - 3 * 60 * 60 * 1000)));

    // Strip the client-side guards: the textarea is `required` with
    // `minLength`, so a browser-respecting submit would be stopped here and the
    // Server Action - the actual gate - would never be exercised.
    await dialog.locator('textarea[name="reason"]').evaluate((el) => {
      el.removeAttribute('required');
      el.removeAttribute('minlength');
    });

    await dialog.getByRole('button', { name: 'Save correction' }).click();

    // Refused, with the rule spelled out, and the dialog stays open on the
    // data rather than closing as if it had worked.
    await expect(
      dialog.getByText(/A reason of at least 4 characters is required/),
    ).toBeVisible({ timeout: 20000 });
    await expect(dialog).toBeVisible();

    // Proof the write did not land: no correction was recorded.
    await page.goto('/dtr');
    await expect(page.getByText('No corrections in this window.')).toBeVisible({
      timeout: 20000,
    });
  });

  test('a reason records the correction, and the employee sees it', async ({
    page,
  }) => {
    await ensureShiftOnRecord(page);
    await page.goto('/dtr');
    const row = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await expect(row).toBeVisible({ timeout: 20000 });

    const dialog = await openCorrectionDialog(page, row);

    // Correct the clock-out rather than the clock-in: the page is filtered by
    // date, so moving the START a day could legitimately drop this very row
    // out of the window being asserted on.
    await dialog.locator('select').selectOption('end');
    await dialog.locator('input[name="value"]').fill(toDatetimeLocal(new Date()));
    const reason = 'E2E - verified missed clock-out';
    await dialog.locator('textarea[name="reason"]').fill(reason);

    await dialog.getByRole('button', { name: 'Save correction' }).click();
    // Closed on success.
    await expect(dialog).toBeHidden({ timeout: 20000 });

    // The manager's view names who, what and why.
    await expect(page.getByText('Recent corrections')).toBeVisible();
    const correction = page.locator('li').filter({ hasText: reason }).first();
    await expect(correction).toBeVisible();
    await expect(correction).toContainText('Admin');
    // And the row itself carries the count of edits made to it.
    await expect(page.getByText(/corrected ×\d+/).first()).toBeVisible();

    // The correction is visible to the person it was made about, with its
    // reason - an attendance edit is not a silent rewrite.
    await openMyActivity(page);
    await expect(page.getByText(reason)).toBeVisible({ timeout: 20000 });
  });
});

test.describe('Phase 5 - responsive layout', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN, false);
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}px): the attendance pages do not scroll sideways`, async ({
      page,
    }) => {
      await ensureShiftOnRecord(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const [name, path, ready] of [
        ['my-hours', '/my-activity', 'text=My hours'],
        ['dtr', '/dtr', 'h1:has-text("Time & attendance")'],
      ] as const) {
        await page.goto(path);
        await expect(page.locator(ready).first()).toBeVisible({ timeout: 25000 });
        // Let fonts/layout settle; an unlaid-out element can briefly overflow.
        await page.waitForTimeout(250);
        expect(
          await hasHorizontalOverflow(page),
          `${name} at ${vp.width}px scrolls horizontally`,
        ).toBe(false);
      }
    });
  }

  test('the correction dialog fits a phone screen and is dismissible', async ({
    page,
  }) => {
    // A dialog is the usual cause of overflow on a phone: a fixed-width panel
    // plus padding does not fit a 390px screen. This one must.
    await ensureShiftOnRecord(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dtr');

    const row = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await expect(row).toBeVisible({ timeout: 25000 });
    const dialog = await openCorrectionDialog(page, row);
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // Every field is present, and the dialog closes on Escape rather than
    // stranding the manager mid-edit on a phone.
    await expect(dialog.locator('select')).toBeVisible();
    await expect(dialog.locator('input[name="value"]')).toBeVisible();
    await expect(dialog.locator('textarea[name="reason"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10000 });
  });
});