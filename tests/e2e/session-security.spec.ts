/**
 * Session-cookie security regression tests (S-1: forged `pos-cashier` cookie).
 *
 * The session cookie used to carry a bare `User.id`, and `/login` published
 * every active user's id — so `pos-cashier=<known-admin-uuid>` was a complete
 * authentication bypass. The cookie is now SIGNED (`<id>.<hmac-sha256-hex>`,
 * see `src/lib/session-token.ts`) and `/login` publishes names only, so a
 * publicly known User ID must never be sufficient to create a session.
 *
 * RULES (matching tests/setup/global-setup.ts + employee-pin.spec.ts policy):
 *  - NO mid-suite reseeding. Two disposable users (one MANAGER, one inactive
 *    ADMIN) are inserted in beforeAll and deleted in afterAll — zero impact on
 *    the seeded Admin/Cashier baseline or other specs.
 *  - Cookie values are minted with the REAL `signSessionValue` implementation
 *    the app uses (never a re-implemented format). `SESSION_SECRET` is shared
 *    with the dev-server webServer (Playwright config): HMAC sides share a key.
 *  - Direct DB access requires the Playwright-provided disposable DATABASE_URL;
 *    it never falls back to the repository's development database.
 *  - Runs under --workers=1 (suite standard).
 */
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getE2EDatabasePath } from '../setup/e2e-database';
import { signSessionValue } from '../../src/lib/session-token';
import { hashPin } from '../../src/lib/pin';

const COOKIE = 'pos-cashier';

// The seed's documented sign-in accounts, also used as the forged-cookie
// targets: the ADMIN id is exactly what an anonymous visitor used to read off
// the old /login payload.
const SEED_ADMIN_EMAIL = 'admin@julspos.test';
const SEED_CASHIER_EMAIL = 'cashier@julspos.test';

const MANAGER = {
  name: 'Session Probe Manager',
  email: 'session-probe-manager@julspos.test',
  pin: '5566',
};

const INACTIVE = {
  name: 'Session Probe Inactive',
  email: 'session-probe-inactive@julspos.test',
  pin: '7788',
};

/** Management routes every signed-in ADMIN/MANAGER must reach. */
const MANAGEMENT_ROUTES = ['/employees', '/purchasing', '/inventory', '/reports', '/settings'] as const;

/** Minimal connection shape used here; better-sqlite3 ships no .d.ts (JS-only). */
interface SqliteConn {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): unknown;
  };
  close(): void;
}

// Playwright must provide the disposable database URL; there is no dev.db fallback.
const DB_PATH = getE2EDatabasePath();

function db(): SqliteConn {
  // better-sqlite3 ships JS-only typings (no .d.ts); the runtime object does
  // have prepare/close — cast through unknown so tsc doesn't trust its guess.
  return new Database(DB_PATH) as unknown as SqliteConn;
}

function getUserIdByEmail(email: string): string {
  const conn = db();
  try {
    const row = conn
      .prepare('SELECT id FROM "User" WHERE email = ?')
      .get(email) as { id: string } | undefined;
    if (!row) throw new Error(`seed user vanished: ${email}`);
    return row.id;
  } finally {
    conn.close();
  }
}

/** Idempotently insert/reset a disposable user; returns its row id. */
async function ensureUserAsync(
  entry: { name: string; email: string; pin: string },
  role: string,
  active: boolean,
): Promise<string> {
  const pinHash = await hashPin(entry.pin);
  const conn = db();
  try {
    const existing = conn
      .prepare('SELECT id FROM "User" WHERE email = ?')
      .get(entry.email) as { id: string } | undefined;
    if (existing) {
      conn
        .prepare('UPDATE "User" SET name = ?, pinHash = ?, role = ?, active = ? WHERE email = ?')
        .run(entry.name, pinHash, role, active ? 1 : 0, entry.email);
      return existing.id;
    }
    const id = randomUUID();
    conn
      .prepare(
        `INSERT INTO "User" (id, name, email, passwordHash, pinHash, active, role, createdAt, updatedAt)
         VALUES (?, ?, ?, 'seed-placeholder', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(id, entry.name, entry.email, pinHash, active ? 1 : 0, role);
    return id;
  } finally {
    conn.close();
  }
}

/** Flip the last hex digit of a valid signed value: valid shape, broken signature. */
function tamper(signed: string): string {
  const last = signed.at(-1) === '0' ? '1' : '0';
  return `${signed.slice(0, -1)}${last}`;
}

/** Install exactly `value` (or no cookie when null) for the app origin. */
async function setSessionCookie(page: import('@playwright/test').Page, value: string | null): Promise<void> {
  await page.context().clearCookies();
  if (value === null) return;
  await page.context().addCookies([{ name: COOKIE, value, path: '/', domain: 'localhost' }]);
}

/** A protected page counts as REJECTED when it bounces to /login, ACCEPTED otherwise. */
async function expectRejected(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/.*\/login.*/, { timeout: 15000 });
}

async function expectAccepted(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).not.toHaveURL(/.*\/login.*/, { timeout: 15000 });
}

let managerId = '';
let inactiveId = '';
let adminId = '';
let cashierId = '';

test.describe('Session cookie security (S-1 forged-cookie regression)', () => {
  test.beforeAll(async () => {
    managerId = await ensureUserAsync(MANAGER, 'MANAGER', true);
    inactiveId = await ensureUserAsync(INACTIVE, 'ADMIN', false);
    adminId = getUserIdByEmail(SEED_ADMIN_EMAIL);
    cashierId = getUserIdByEmail(SEED_CASHIER_EMAIL);
    expect(managerId).toBeTruthy();
    expect(inactiveId).toBeTruthy();
  });

  test.afterAll(() => {
    // Remove the disposable users — the shared DB must look untouched to the
    // other specs (seed only upserts Admin/Cashier, nothing depends here).
    const conn = db();
    try {
      conn.prepare('DELETE FROM "User" WHERE email = ?').run(MANAGER.email);
      conn.prepare('DELETE FROM "User" WHERE email = ?').run(INACTIVE.email);
    } finally {
      conn.close();
    }
  });

  test('anonymous user (no cookie) is rejected from protected routes', async ({ page }) => {
    await setSessionCookie(page, null);
    for (const path of MANAGEMENT_ROUTES) {
      await expectRejected(page, path);
    }
    await expectRejected(page, '/pos');
  });

  test('random invalid cookie is rejected from protected routes', async ({ page }) => {
    await setSessionCookie(page, 'not-a-session');
    for (const path of MANAGEMENT_ROUTES) {
      await expectRejected(page, path);
    }
    await expectRejected(page, '/pos');
  });

  test('forged UNSIGNED admin UUID cookie is rejected (id alone is not a session)', async ({ page }) => {
    // THE key regression: the raw User.id — exactly what the old /login page
    // exposed — must never be sufficient to create an authenticated session.
    await setSessionCookie(page, adminId);
    for (const path of MANAGEMENT_ROUTES) {
      await expectRejected(page, path);
    }
    await expectRejected(page, '/pos');
  });

  test('forged TAMPERED signed cookie is rejected', async ({ page }) => {
    await setSessionCookie(page, tamper(signSessionValue(adminId)));
    for (const path of MANAGEMENT_ROUTES) {
      await expectRejected(page, path);
    }
    await expectRejected(page, '/pos');
  });

  test('valid signed CASHIER session reaches the register, not management', async ({ page }) => {
    await setSessionCookie(page, signSessionValue(cashierId));
    await expectAccepted(page, '/pos');
    for (const path of MANAGEMENT_ROUTES) {
      await page.goto(path);
      // CASHIERs are signed in but belong on the register: the dashboard
      // layout bounces them to /pos rather than showing management views.
      await expect(page).toHaveURL(/.*\/pos$/, { timeout: 15000 });
    }
  });

  test('valid signed MANAGER session works on management routes', async ({ page }) => {
    await setSessionCookie(page, signSessionValue(managerId));
    for (const path of MANAGEMENT_ROUTES) {
      await expectAccepted(page, path);
    }
  });

  test('valid signed ADMIN session works on management routes', async ({ page }) => {
    await setSessionCookie(page, signSessionValue(adminId));
    for (const path of MANAGEMENT_ROUTES) {
      await expectAccepted(page, path);
    }
  });

  test("deactivated user's signed session is rejected", async ({ page }) => {
    // The signature is valid but the account is offboarded: `active: false`
    // must revoke the session immediately.
    await setSessionCookie(page, signSessionValue(inactiveId));
    for (const path of MANAGEMENT_ROUTES) {
      await expectRejected(page, path);
    }
    await expectRejected(page, '/pos');
  });

  test('/login payload exposes neither internal User IDs nor roles', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.ok()).toBe(true);
    const html = await page.content();
    // The staff picker renders names only — internal identifiers must not
    // appear anywhere in the served payload. (Note: the seeded users are
    // literally NAMED "Admin"/"Cashier", so name text matching a role word is
    // expected — what must be absent is any role FIELD, checked below.)
    expect(html).not.toContain(adminId);
    expect(html).not.toContain(cashierId);
    expect(html).not.toContain(managerId);
    // The RSC flight payload serializes the `users` prop with escaped quotes
    // (`{\"name\":\"...\"}`); unescape once and prove every entry is name-only.
    const flat = html.replace(/\\/g, '');
    const match = flat.match(/"users":\[(.*?)\]/);
    expect(match, 'login payload must serialize a users array').not.toBeNull();
    const usersJson = match![1];
    expect(usersJson).toContain('"name"');
    expect(usersJson).not.toContain('"role"');
    expect(usersJson).not.toContain('"id"');
  });
});
