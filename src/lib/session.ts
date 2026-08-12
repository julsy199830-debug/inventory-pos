import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { asRole, type Role } from "@/lib/types";

/**
 * Cashier session persistence.
 *
 * The POS register is the only place in the app that needs an authenticated
 * actor today — there's no site-wide auth layer (the dashboard routes are open,
 * the Employees module is management tooling). Rather than bolt on a half
 * framework, we keep a single signed-in-cashier cookie scoped to `/pos`: the
 * cashier signs in once with their PIN, the {@link COOKIE} holds their `User.id`,
 * and every subsequent visit to `/pos` (and every `createSale` Server Action
 * invocation) reads it back to attribute sales and gate checkout.
 *
 * Design choices (from the integration plan):
 *   - "Sign in once, persists" → a real `maxAge` cookie, not a per-tab flag, so a
 *     reload or a fresh tab keeps the cashier logged in until they sign out.
 *   - The cookie is `httpOnly` + `sameSite: "lax"`: never readable from client JS
 *     (so a third-party script can't exfiltrate the cashier id), but lax is enough
 *     because we don't carry the credential to cross-origin sites. It is NOT
 *     `secure: true` on purpose — this app runs on plain HTTP in dev (`next dev`)
 *     and SQLite locally; a `secure`-only cookie would vanish on localhost and
 *     break the very flow it exists to support. If this ever ships over real
 *     HTTPS, flip `secure` to `true` (or gate it on `process.env.NODE_ENV`).
 *
 * `cookies()` is async in Next 16 (see the `04-functions/cookies.md` doc + the
 * `v15.0.0-RC` version-history note): every read/write here `await`s it. Using
 * it in the POS page opts that route into dynamic rendering, which is correct —
 * a personalized POS view can't be statically cached anyway.
 */

/** Cookie name carrying the signed-in cashier's `User.id`. */
export const COOKIE = "pos-cashier";

/** Session lifetime: ~12 hours in seconds. A full work shift comfortably fits,
 *  while the cookie won't outlive the day if a cashier forgets to sign out —
 *  same intent as the shift auto-close in `clockIn`. */
const MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * The cashier shape read off the cookie. Narrowed subset of `User` — we only
 * ever need `id`/`name`/`role` for attribution and the POS navbar, and selecting
 * just those keeps the password hash and PIN out of any accidental leak.
 */
export type CashierSession = {
  id: string;
  name: string;
  role: Role;
};

/**
 * Set the cashier-session cookie. Call from a Server Action only — Next rejects
 * `cookieStore.set` during Server Component rendering (the cookies doc's
 * "Server Functions" note), and both our callers (`signInCashierPin` in
 * `pos/actions.ts`) are Server Actions, so that's where this belongs.
 *
 * The cookie value is the raw `User.id` (a UUID). We don't sign it because the
 * only effect of a forged cookie is attributing future sales to a victim cashier
 * — annoying, not a privilege escalation — and PIN sign-in already validated the
 * identity server-side. If attribution integrity ever matters more, swap in a
 * signed/token value here.
 */
export async function setCashierCookie(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Clear the cashier-session cookie. Server-Action-only, same constraint as
 * {@link setCashierCookie}. Deleting and re-setting to empty are both options
 * per the cookies doc; `delete` is the honest "remove entirely" choice here.
 */
export async function clearCashierCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
}

/**
 * Read the signed-in cashier off the request, or `null` when there's no session
 * cookie / the id doesn't resolve to an active `User`.
 *
 * `active: true` is part of the lookup because an offboarded cashier (their
 * `active` bit flipped by `toggleEmployeeStatus`) must not continue ringing up
 * sales even if their cookie hasn't expired — the `User.active` schema comment
 * makes this exact case the reason `active` exists. A stale cookie for a
 * deactivated user simply yields no session, and the POS gate makes them sign in
 * again (which will then reject).
 *
 * Usable from both Server Components (the POS page) and Server Actions
 * (`createSale`) — `cookies()` reads are allowed in both.
 */
export async function getCashier(): Promise<CashierSession | null> {
  const cookieStore = await cookies();
  const id = cookieStore.get(COOKIE)?.value;
  if (!id) return null;

  const user = await prisma.user.findFirst({
    where: { id, active: true },
    select: { id: true, name: true, role: true },
  });
  if (!user) return null;
  return { id: user.id, name: user.name, role: asRole(user.role) };
}

/**
 * Throwing variant of {@link getCashier} for Server Actions that genuinely
 * cannot proceed without a cashier — today only `createSale`. Throws a typed
 * error the caller can map to a clean client message; it never reaches the
 * client raw (the action's own try/catch translates it).
 */
export class NoCashierError extends Error {
  constructor() {
    super("NO_CASHIER");
    this.name = "NoCashierError";
  }
}

/**
 * Resolve the signed-in cashier or throw {@link NoCashierError}. The action
 * layer catches this and surfaces "Sign in to the register to complete this
 * sale." — the same friendly-but-leak-free convention every other action here
 * uses (see the inline-known-failure pattern in `createSale`).
 */
export async function requireCashierSession(): Promise<CashierSession> {
  const cashier = await getCashier();
  if (!cashier) throw new NoCashierError();
  return cashier;
}

/**
 * Server-Component auth gate: resolve the current user, or `redirect` to
 * `/login` (preserving the intended destination as `?next=` so the sign-in
 * screen can send the user back where they were headed).
 *
 * Call from a layout or page that requires *any* signed-in actor:
 *
 *   const user = await requirePageAuth();
 *   if (user.role === "CASHIER") redirect("/pos");
 */
export async function requirePageAuth(): Promise<CashierSession> {
  const user = await getCashier();
  if (!user) redirect("/login");
  return user;
}

/**
 * Role check for Server Actions that must return a structured error instead of
 * redirecting (a Server Action can't `redirect()` its own caller's page
 * reliably — the client renders the returned `error` inline instead).
 *
 * Returns a message when the current user is missing or lacks one of `allowed`,
 * else `null`. Pair with the branch:
 *
 *   const denied = await roleGuardError(["ADMIN", "MANAGER"]);
 *   if (denied) return { ok: false, error: denied };
 */
export async function roleGuardError(
  allowed: readonly Role[],
): Promise<string | null> {
  const user = await getCashier();
  if (!user) return "You must be signed in to do that.";
  if (!allowed.includes(user.role)) {
    return "You don't have permission to do that.";
  }
  return null;
}
