"use server";

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { setCashierCookie, clearCashierCookie } from "@/lib/session";
import { PIN_PATTERN } from "@/lib/pin";
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
 * Login keys off `User.pin` (the numeric login handle — see the `User.pin`
 * schema comment) + `User.active`, exactly as the schema intends. We deliberately
 * don't involve `passwordHash` here: PIN is the documented POS login mechanism,
 * and keeping this path independent of the password hash means a cashier can sign
 * in to the register without a password ever being set.
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
 * Constant-time comparison of two strings of equal length, so a wrong PIN
 * doesn't leak how many leading digits matched via response timing. Returns
 * `false` (not throw) on length mismatch so the caller can fold it into the
 * normal "wrong PIN" path without a try/catch.
 *
 * Mirrors the `timingSafeEqual` usage in `verifyPassword` (employees/actions.ts)
 * — same security posture, applied to the plaintext PIN column instead of the
 * scrypt hash.
 */
function pinsMatch(candidate: string, stored: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, pin: true, active: true, role: true },
  });

  // The shape of "wrong PIN" and "no such user" and "offboarded" are deliberately
  // identical from the caller's view — return the same generic message so the
  // response reveals nothing about which users exist or are active. The active
  // re-check here is belt-and-suspenders on top of the gate only listing them.
  if (!user || !user.active || !pinsMatch(pin, user.pin)) {
    return { ok: false, error: "Incorrect employee or PIN." };
  }

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
