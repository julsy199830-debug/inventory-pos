"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { setCashierCookie, clearCashierCookie } from "@/lib/session";
import {
  checkRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  RATE_LIMITED_MESSAGE,
  type RateVerdict,
} from "@/lib/rate-limit";
import { PIN_PATTERN, verifyPin } from "@/lib/pin";
import { asRole, type Role, type ActionResult } from "@/lib/types";

/**
 * Cashier sign-in / sign-out for the POS register.
 *
 * Kept in its own action file (`pos/actions.ts`) separate from the employees
 * `actions.ts` because the concerns are different: the Employees module manages
 * the roster (CRUD/role/active/shift); the POS module *authenticates a cashier
 * against that roster*. A cashier sign-in is also driven by the POS page's
 * inline gate (not the Employees dialogs), so co-locating it with the POS route
 * matches where it's called from.
 *
 * Login authenticates against `User.pinHash` — the account's ONLY credential —
 * plus `User.active`. We deliberately don't involve `passwordHash` here: PIN is
 * the documented POS login mechanism, and keeping this path independent of the
 * password hash means a cashier can sign in to the register without a password
 * ever being set.
 *
 * Verification is hash-ONLY (plaintext retirement complete): the candidate PIN
 * is recomputed through scrypt against the stored versioned hash via
 * {@link verifyPin} — never plain equality, and there is no plaintext fallback
 * of any kind. A wrong PIN, an unknown account, an offboarded employee, or a
 * somehow-malformed stored hash all return the same generic failure, revealing
 * nothing about which condition it was.
 */

/**
 * Result shape for {@link signInCashierPin} — the shared discriminated
 * {@link ActionResult} with no success payload (`ActionResult<void>` reads back
 * as `{ ok: true } | { ok: false; error: string }`). The discriminated `ok`
 * matches the `CreateSaleResult` convention so the POS gate's submit handler
 * branches the same way it does for sale checkout. No payload on success — the
 * cookie is set and the page revalidates, so the signed-in UI streams in on its
 * own.
 */
export type SignInResult = ActionResult<{ role: Role }>;

/**
 * Best-effort request-source identifier for the rate limiter.
 *
 * HONEST LIMITATION: inside a Next.js Server Action there is no socket-level
 * remote address, so the only candidate is the `x-forwarded-for` header — and
 * that header is trivially spoofable by a direct client. This deployment has
 * no reverse proxy in front of the app, so we do NOT pretend the header is
 * trustworthy: we read it when present (harmless if a proxy is ever added),
 * and otherwise fold every direct client into a single shared fallback
 * bucket. Consequence: on this LAN the per-IP limiter behaves as a global
 * brake on total failure volume (20 fails / 5 min) rather than a true
 * per-machine limit — which is exactly the anti-cycling protection wanted,
 * and its thresholds are sized well above any legitimate staff usage. The
 * per-USER dimension (keyed by the server-resolved account id) is unaffected
 * and remains the primary boundary.
 */
async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "direct-client";
}

/**
 * Sign a cashier into the POS register.
 *
 * Server-authoritative like every other action: the PIN is re-validated, the
 * user re-resolved, and re-checked for `active` here — never trusting that the
 * POS gate ran any of it. A turned-off employee (`active: false`) is rejected
 * even though the gate only listed active users, so revoking access takes effect
 * immediately, not at the next gate render (see {@link setCashierCookie} for why
 * `active` is the soft-delete gate).
 *
 * On success we set the persisted cookie (sign-in once, survives reloads). We do
 * NOT `revalidatePath('/pos')` here: the cookie write already makes the next
 * render dynamic (cookies are request-time), and the page reads the session fresh
 * on every navigation, so there's nothing cached to purge. The client simply
 * lets the action resolve and the gate swaps to the register.
 */
export async function signInCashierPin(input: {
  userId: string;
  pin: string;
}): Promise<SignInResult> {
  const userId = (input.userId ?? "").trim();
  const pin = (input.pin ?? "").trim();

  if (!userId) return { ok: false, error: "Select an employee to sign in." };
  if (!pin || !PIN_PATTERN.test(pin)) {
    return { ok: false, error: "PIN must be 4–6 digits." };
  }

  // ── Rate limiting (Stage 4) ──────────────────────────────────────────────
  // Synchronous and FIRST: a throttled attempt never reaches the database or
  // the scrypt verifier, so an attacker cannot spend our CPU or learn anything
  // about the account from this path. The client-supplied `userId` is used
  // only as a bucket key here — the actual authentication decision below is
  // still made entirely server-side.
  const ip = await clientIp();
  const verdict: RateVerdict = checkRateLimit(userId, ip);
  if (verdict !== "ok") {
    // Same shape as every other failure so the UI needs no special case, but a
    // distinct, deliberately vague message: no counters, no remaining
    // attempts, no hint whether the employee exists.
    return { ok: false, error: RATE_LIMITED_MESSAGE };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      pinHash: true,
      active: true,
      role: true,
    },
  });

  // The shape of "wrong PIN" and "no such user" and "offboarded" are deliberately
  // identical from the caller's view — return the same generic message so the
  // response reveals nothing about which users exist, are active, or have a
  // malformed hash. The active re-check here is belt-and-suspenders on top of the gate
  // only listing them. Every one of these outcomes also counts as a failed
  // login attempt for the rate limiter (the limiter never learns which kind it
  // was, and this action never tells it).
  if (!user || !user.active) {
    recordLoginFailure(userId, ip);
    return { ok: false, error: "Incorrect employee or PIN." };
  }

  // Hash-ONLY verification (plaintext retired). `verifyPin` recomputes scrypt
  // against the stored versioned hash with timing-safe comparison and fails
  // closed — a malformed/stale hash returns false, never authenticates, and
  // there is no plaintext fallback of any kind.
  const authenticated = await verifyPin(pin, user.pinHash);
  if (!authenticated) {
    recordLoginFailure(userId, ip);
    return { ok: false, error: "Incorrect employee or PIN." };
  }

  // A genuine sign-in clears this account's failure counter and lockout (and
  // empties this source's rolling failure window) before the session is
  // issued — success must never leave stale throttling behind.
  recordLoginSuccess(user.id, ip);

  await setCashierCookie(user.id);
  return { ok: true, role: asRole(user.role) };
}

/**
 * Sign the current cashier out of the POS register — clears the session cookie.
 *
 * No payload and no failure mode worth surfacing: deleting a cookie that's
 * already absent is a no-op, and there's nothing else to validate. Idempotent on
 * purpose so a double-click or a stale-tab sign-out can't error out.
 */
export async function signOutCashier(): Promise<void> {
  await clearCashierCookie();
}
