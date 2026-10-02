import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Integrity protection for the `pos-cashier` session cookie.
 *
 * WHY THIS MODULE EXISTS (read before changing): the session cookie used to
 * carry a bare `User.id` — a UUID that is *not* a secret. Three independent
 * facts made that exploitable:
 *
 *   1. `/login` published every active user's id (and role) in the RSC payload
 *      of an unauthenticated page, so an anonymous visitor could read them.
 *   2. `setCashierCookie` wrote that id verbatim, with no signature.
 *   3. `getCashier` — the single trust root for `requirePageAuth`,
 *      `roleGuardError`, audit attribution and the POS — accepted any cookie
 *      value that resolved to an active user.
 *
 * So `pos-cashier=<a-known-admin-uuid>` was a complete authentication bypass,
 * reachable by anyone who could load `/login`. The fix is to make the cookie
 * value *signed*: `"<id>.<hmac-sha256-hex>"`. Knowing an id is no longer
 * sufficient — an attacker cannot produce the signature without the secret, and
 * an unsigned/tampered value is rejected before any database lookup.
 *
 * This module is deliberately importable from plain Node (no `server-only`, no
 * Next imports, `node:crypto` only) so test harnesses can mint and verify
 * tokens with the exact same implementation the app uses. Never re-implement
 * the format elsewhere — that is how a test drifts into proving nothing.
 *
 * CONFIGURATION
 *   - `SESSION_SECRET` (required in production, >= {@link MIN_SECRET_LENGTH}
 *     chars). Outside production a fixed, clearly-labelled development fallback
 *     is used so `next dev`, the unit harness and SQLite-only local runs work
 *     with no setup. There is intentionally NO insecure fallback in production:
 *     a missing/short secret throws instead of quietly weakening every session.
 *   - `SESSION_COOKIE_SECURE` (`"true"`/`"1"`/`"yes"`/`"on"`) opts the cookie
 *     into the `Secure` attribute. It is an explicit opt-in rather than
 *     `NODE_ENV === "production"` because this app is documented to run over
 *     plain HTTP on an internal LAN: a `Secure` cookie would be dropped by the
 *     browser there and would silently break sign-in.
 */

/** Environment variable holding the HMAC key used to sign session cookies. */
export const SESSION_SECRET_ENV = "SESSION_SECRET";

/** Environment variable that opts the session cookie into `Secure`. */
export const SESSION_COOKIE_SECURE_ENV = "SESSION_COOKIE_SECURE";

/** Minimum accepted {@link SESSION_SECRET_ENV} length, in characters. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Development-only fallback key. Fixed (not random per boot) so a cookie issued
 * by `next dev` still verifies after a restart — a random fallback would log
 * every developer out on each restart for no security benefit, since the
 * fallback never applies to a production runtime.
 */
const DEV_FALLBACK_SECRET = "inventory-pos-development-only-session-secret-key";

/**
 * Token version mixed into the signed payload. Bumping it invalidates every
 * outstanding cookie (the shape stays `<id>.<hex>`), which is what you want if
 * the signing scheme itself ever changes.
 */
const TOKEN_VERSION = "v1";

/** A sha256 HMAC rendered as lowercase hex is exactly 64 characters. */
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

/** True when the process is a production runtime (`next start` / `next build`). */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Resolve the signing key, failing closed rather than falling back:
 *   - set and long enough → use it;
 *   - set but too short → throw (a weak key is a real risk, not a warning);
 *   - unset in production → throw (never sign with a known constant in prod);
 *   - unset outside production → documented dev fallback.
 */
export function sessionSecret(): string {
  const value = process.env[SESSION_SECRET_ENV]?.trim();
  if (value) {
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `${SESSION_SECRET_ENV} must be at least ${MIN_SECRET_LENGTH} characters long (received ${value.length}).`,
      );
    }
    return value;
  }
  if (isProductionRuntime()) {
    throw new Error(
      `${SESSION_SECRET_ENV} must be set to a random value of at least ${MIN_SECRET_LENGTH} characters in production.`,
    );
  }
  return DEV_FALLBACK_SECRET;
}

/** Compute the signature for `id` under the current key. */
function signatureFor(id: string): string {
  return createHmac("sha256", sessionSecret())
    .update(`${TOKEN_VERSION}:${id}`)
    .digest("hex");
}

/**
 * Sign an id into the cookie value written to the response. Callers never write
 * a raw id: the only writer is `setCashierCookie` in `./session.ts`.
 */
export function signSessionValue(id: string): string {
  return `${id}.${signatureFor(id)}`;
}

/**
 * Verify a cookie value and return the id it vouches for, or `null` when the
 * value is missing, unsigned, malformed, or not signed by the current key.
 *
 * Rejects, in order: no value; no separator; empty id; a signature that isn't
 * 64 lowercase hex chars; a valid-shaped but wrong signature (compared with
 * `timingSafeEqual`, so the comparison leaks no prefix information). A non-hex
 * signature is rejected *before* comparison because `Buffer.from(x, "hex")`
 * silently truncates at the first invalid character, which would otherwise let
 * a short attacker-supplied digest compare equal to a prefix of the real one.
 */
export function unsignSessionValue(token: string | null | undefined): string | null {
  if (!token) return null;
  const separator = token.indexOf(".");
  // `<= 0` also rejects a leading dot (empty id) and a missing separator.
  if (separator <= 0) return null;
  const id = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  if (!SIGNATURE_PATTERN.test(provided)) return null;

  const expectedBytes = Buffer.from(signatureFor(id), "hex");
  const providedBytes = Buffer.from(provided, "hex");
  if (expectedBytes.length !== providedBytes.length) return null;
  if (!timingSafeEqual(expectedBytes, providedBytes)) return null;
  return id;
}

/** True when {@link SESSION_COOKIE_SECURE_ENV} opts the cookie into `Secure`. */
export function secureCookiesEnabled(): boolean {
  const value = process.env[SESSION_COOKIE_SECURE_ENV]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}
