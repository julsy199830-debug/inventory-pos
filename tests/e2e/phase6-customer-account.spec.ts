import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

/**
 * Phase 6 E2E: the customer account / statement page.
 *
 * The claim under test is that the balance is DERIVED from records. Before Phase
 * 6 the statement listed cash and card sales as if they were charges, so it
 * described money the customer did not owe.
 *
 * Fixture strategy: an account adjustment has no UI (the server action exists
 * and is manager-guarded, but nothing renders it yet), and refunds need a
 * multi-step POS flow. Rather than assert against whatever the seed happens to
 * contain, this spec writes a KNOWN ledger shape into the disposable
 * `test-db/e2e.db`, then drives the real UI to read it back.
 *
 * The fixture is seeded by SPAWNING `tests/setup/phase6-account-fixture.ts`, not
 * by importing Prisma here. The generated client uses `import.meta`, which throws
 * inside Playwright's CommonJS module scope and — because a load failure aborts
 * collection — takes the whole suite down with it. Spawning also keeps the
 * application code free of test-only accommodations.
 *
 * The amounts cover every movement direction:
 *   charge +500 -> payment -200 -> refund -100 -> write-off -50
 *   closing balance = 150
 *
 * Nothing here re-implements the ledger. The running-balance check asserts the
 * DISPLAYED column's own invariant — each row's balance equals the previous plus
 * this row's signed amount — which is a property of what the customer sees, not
 * a re-derivation of `src/lib/ledger`.
 */

type Page = import('@playwright/test').Page;

const ADMIN = { button: 'button:has-text("Admin")', pin: '1234' };
const CASHIER = { button: 'button:has-text("Cashier")', pin: '0000' };

/** Marker suffix so repeated runs never collide on the unique email. */
const TAG = `p6${Date.now().toString().slice(-7)}`;

const CHARGE = 500;
const PAYMENT = 200;
const REFUND = 100;
const ADJUSTMENT = 50;
const CLOSING = CHARGE - PAYMENT - REFUND - ADJUSTMENT; // 150

let customerAId = '';
let customerBId = '';

/** Run the fixture helper in its own process; `seed` returns the two ids. */
function fixture(mode: 'seed' | 'clean'): { a: string; b: string } {
  // `shell: true` is required on Windows: spawning a `.cmd` shim directly
  // without a shell yields no stdout/stderr at all, which surfaced as
  // "fixture seed failed: undefined" rather than a useful error.
  const res = spawnSync(
    `npx tsx tests/setup/phase6-account-fixture.ts ${mode} ${TAG}`,
    {
      encoding: 'utf8',
      env: process.env,
      shell: true,
    },
  );
  if (res.status !== 0) {
    throw new Error(
      `fixture ${mode} failed (${res.status}): ${res.stderr || res.stdout || 'no output'}`,
    );
  }
  // npx echoes its own banner lines, so take the LAST line that is our JSON.
  const line = res.stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error(`fixture ${mode} produced no JSON: ${res.stdout}`);
  return JSON.parse(line);
}

async function login(page: Page, who: typeof ADMIN | typeof CASHIER) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator(who.button).first().click();
  const pin = page.locator('input[type="password"]');
  await expect(pin).toBeEnabled({ timeout: 15000 });
  await pin.fill(who.pin);
  await page.locator('button:has-text("Open register")').first().click();
  await expect(page).not.toHaveURL(/.*\/login/, { timeout: 15000 });
}

test.beforeAll(() => {
  const ids = fixture('seed');
  customerAId = ids.a;
  customerBId = ids.b;
});

test.afterAll(() => {
  // Disposable DB, but clean up so a re-run cannot double-count.
  fixture('clean');
});

/**
 * Parse the rendered ledger into signed amounts and running balances.
 *
 * Reads the rendered table, so it asserts on what the CUSTOMER sees. It
 * deliberately does NOT recompute the balance from the sale/payment/refund
 * tables — that logic lives in `src/lib/ledger` and is already unit-tested.
 */
async function readLedger(page: Page) {
  const rows = page.locator('[data-testid="account-ledger"] tbody tr[data-ledger-kind]');
  const n = await rows.count();
  const out: { kind: string; amount: number; balance: number }[] = [];
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const cells = row.locator('td');
    const kind = (await row.getAttribute('data-ledger-kind')) ?? '';
    const amountText = (await cells.nth(3).innerText()).trim();
    const balanceText = (await cells.nth(4).innerText()).trim();
    // The amount cell renders "—", "+₱500.00" or "−₱200.00". The minus is
    // U+2212 MINUS SIGN, not ASCII "-", so normalise before parsing.
    const amount =
      amountText === '—'
        ? 0
        : Number(
            amountText.replace(/−/g, '-').replace(/[^\d.-]/g, ''),
          );
    out.push({ kind, amount, balance: Number(balanceText.replace(/[^\d.-]/g, '')) });
  }
  return out;
}

/** Read a summary tile's value by its label. */
async function tileValue(page: Page, label: string): Promise<number> {
  const tile = page.locator('p', { hasText: new RegExp(`^${label}$`) }).first();
  await expect(tile).toBeVisible({ timeout: 20000 });
  const value = await tile.locator('xpath=following-sibling::p[1]').innerText();
  return Number(value.replace(/[^\d.-]/g, ''));
}

test.describe('Phase 6 — customer account', () => {
  test('the account page shows every movement kind distinctly', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(`/customers/${customerAId}`);
    await expect(page.getByTestId('account-ledger')).toBeVisible({ timeout: 25000 });

    for (const kind of ['CHARGE', 'PAYMENT', 'REFUND', 'ADJUSTMENT']) {
      await expect(
        page.locator(`tr[data-ledger-kind="${kind}"]`).first(),
      ).toBeVisible({ timeout: 20000 });
    }
  });

  test('every row moves the balance the right way and the running column is self-consistent', async ({
    page,
  }) => {
    await login(page, ADMIN);
    await page.goto(`/customers/${customerAId}`);
    await expect(page.getByTestId('account-ledger')).toBeVisible({ timeout: 25000 });

    const rows = await readLedger(page);
    expect(rows.length, 'expected at least four ledger movements').toBeGreaterThanOrEqual(4);

    // Direction: a CHARGE raises what is owed; every other movement lowers it.
    const charge = rows.find((r) => r.kind === 'CHARGE');
    expect(charge, 'a charge row must exist').toBeTruthy();
    expect(charge!.amount, 'a charge increases the balance').toBeGreaterThan(0);
    for (const kind of ['PAYMENT', 'REFUND', 'ADJUSTMENT']) {
      const row = rows.find((r) => r.kind === kind);
      expect(row, `${kind} row must exist`).toBeTruthy();
      expect(row!.amount, `${kind} decreases the balance`).toBeLessThan(0);
    }

    // The DISPLAYED running-balance column obeys its own invariant.
    let running = 0;
    for (const r of rows) {
      running = Math.round((running + r.amount) * 100) / 100;
      expect(
        Math.abs(r.balance - running) < 0.01,
        `running balance drifted at ${r.kind}: displayed ${r.balance}, expected ${running}`,
      ).toBe(true);
    }
    expect(Math.abs(running - CLOSING), 'closing balance').toBeLessThan(0.01);
  });

  test('summary tiles agree with the ledger rows they summarise', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(`/customers/${customerAId}`);
    await expect(page.getByTestId('account-ledger')).toBeVisible({ timeout: 25000 });

    const rows = await readLedger(page);
    const sum = (k: string) =>
      Math.round(rows.filter((r) => r.kind === k).reduce((n, r) => n + r.amount, 0) * 100) /
      100;

    // Tile and rows come from the same buildLedger output, so any disagreement
    // is a real rendering bug rather than a rounding artifact.
    expect(Math.abs((await tileValue(page, 'Charges')) - sum('CHARGE'))).toBeLessThan(0.01);
    // Refunds are stored as reductions, so the tile (a positive magnitude) and
    // the signed rows are opposites of each other.
    expect(Math.abs((await tileValue(page, 'Refunds')) + sum('REFUND'))).toBeLessThan(0.01);
    expect(Math.abs((await tileValue(page, 'Outstanding balance')) - CLOSING)).toBeLessThan(0.01);
  });

  test('loyalty activity is shown as a history', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(`/customers/${customerAId}`);
    await expect(page.getByTestId('loyalty-history')).toBeVisible({ timeout: 25000 });
    await expect(page.getByText('Earned on sale')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Redeemed at checkout')).toBeVisible({ timeout: 20000 });
  });

  test('the date filter narrows the ledger but keeps the TRUE closing balance', async ({
    page,
  }) => {
    await login(page, ADMIN);
    await page.goto(`/customers/${customerAId}`);
    await expect(page.getByTestId('account-ledger')).toBeVisible({ timeout: 25000 });
    expect((await readLedger(page)).length).toBeGreaterThanOrEqual(4);

    // Narrow to the write-off day alone.
    // `exact: true` is required: a substring match on "To" also resolves the
    // "From" label (it contains "to") plus another field, tripping Playwright's
    // strict-mode violation.
    await page.getByLabel('From', { exact: true }).fill('2026-03-11');
    await page.getByLabel('To', { exact: true }).fill('2026-03-11');
    await page.locator('button:has-text("Apply")').click();
    await expect(page).toHaveURL(/from=2026-03-11/, { timeout: 20000 });
    await expect(page.getByTestId('account-ledger')).toBeVisible({ timeout: 25000 });

    const windowed = await readLedger(page);
    expect(windowed.length, 'only the adjustment falls in this window').toBe(1);
    expect(windowed[0].kind).toBe('ADJUSTMENT');

    // THE important assertion. Recomputing the window in isolation would report
    // -50; the customer actually owed 150, which is what must be shown.
    expect(
      Math.abs((await tileValue(page, 'Outstanding balance')) - CLOSING),
      'a filtered statement must still report the real balance owed',
    ).toBeLessThan(0.01);
  });

  test('the statement exports a CSV scoped to this customer', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(`/customers/${customerAId}`);
    const link = page.getByTestId('statement-export');
    await expect(link).toBeVisible({ timeout: 25000 });
    const href = await link.getAttribute('href');
    expect(href, 'export must be a data: URL').toMatch(/^data:text\/csv/);
    const csv = decodeURIComponent(href!.replace(/^data:text\/csv;charset=utf-8,/, ''));
    expect(csv).toContain(`Ledger Alpha ${TAG}`);
    // Raw numbers, not glyph-formatted, so a bookkeeper can sum the column.
    expect(csv).toContain(CHARGE.toFixed(2));
    expect(csv).toContain(`-${PAYMENT.toFixed(2)}`);
  });

  test('a print control is offered for a print-friendly statement', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto(`/customers/${customerAId}`);
    await expect(page.getByTestId('statement-print')).toBeVisible({ timeout: 25000 });
  });
});

// ── Scope & RBAC ──────────────────────────────────────────────────────────────

test.describe('Phase 6 — customer account authorization', () => {
  test("another customer's page does not expose this customer's data", async ({
    page,
  }) => {
    await login(page, ADMIN);
    await page.goto(`/customers/${customerBId}`);
    await expect(page.getByTestId('account-ledger')).toBeVisible({ timeout: 25000 });

    // Customer B has no movements; none of A's reasons may leak in.
    await expect(page.getByText(`Ledger Alpha ${TAG}`)).toHaveCount(0);
    await expect(page.getByText('Goodwill write-off')).toHaveCount(0);
    await expect(page.getByText('Partial settlement')).toHaveCount(0);
    expect(await tileValue(page, 'Outstanding balance')).toBe(0);
  });

  test('a CASHIER cannot reach the customer account page', async ({ page }) => {
    await login(page, CASHIER);
    await page.goto(`/customers/${customerAId}`);
    await expect(page).not.toHaveURL(/\/customers\//, { timeout: 20000 });
    await expect(page.getByText(`Ledger Alpha ${TAG}`)).toHaveCount(0);
  });

  test('an anonymous visitor cannot reach the customer account page', async ({ page }) => {
    await page.goto(`/customers/${customerAId}`);
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
    await expect(page.getByText(`Ledger Alpha ${TAG}`)).toHaveCount(0);
  });
});