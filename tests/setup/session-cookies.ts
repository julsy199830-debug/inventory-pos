/**
 * Shared test session helper for Server Action suites (unit/integration).
 *
 * The `pos-cashier` cookie is SIGNED (`<id>.<hmac>`, see
 * `src/lib/session-token.ts`): `getCashier` rejects any unsigned value before
 * the database lookup, so writing a bare `User.id` into the mocked cookie jar
 * is no longer an authenticated session. These helpers mint cookies with the
 * SAME implementation the app uses (never a re-implemented format), so a test
 * that passes here proves the real signing path accepts the value.
 *
 * Import AFTER the local `Module._resolveFilename` mock patch AND after
 * `process.env.DATABASE_URL` points at the suite's throwaway database, but
 * BEFORE any `@/...` app import (the session module reads its secret lazily,
 * but the db module binds its URL at import time).
 *
 *   const { asUser, signedOut, signedValue, tamperedValue } =
 *     await import("../setup/session-cookies");
 */
import { signSessionValue } from "@/lib/session-token";

declare global {
  var __PO_TEST_COOKIES__: Record<string, string> | undefined;
}

/** Cookie name carrying the signed-in cashier's `User.id`. */
const COOKIE = "pos-cashier";

/** Mint the exact cookie value the app would issue for `userId`. */
export function signedValue(userId: string): string {
  return signSessionValue(userId);
}

/**
 * Flip the last hex digit of a signed value, keeping the `<id>.<64-hex>`
 * shape but breaking the signature — the tampered-cookie case.
 */
export function tamperedValue(userId: string): string {
  const signed = signedValue(userId);
  const last = signed.at(-1) === "0" ? "1" : "0";
  return `${signed.slice(0, -1)}${last}`;
}

/** Point the mocked cookie jar at a SIGNED session for `userId`. */
export function asUser(userId: string | null): void {
  globalThis.__PO_TEST_COOKIES__ =
    userId === null ? {} : { [COOKIE]: signedValue(userId) };
}

/** Empty jar = signed out (`getCashier` → null → guards deny). */
export function signedOut(): void {
  globalThis.__PO_TEST_COOKIES__ = {};
}

/**
 * Write a RAW (unsigned) cookie value — the forged-session case. Knowing a
 * `User.id` must never be sufficient to authenticate, so tests use this to
 * prove an unsigned id is rejected.
 */
export function asRawCookieValue(value: string): void {
  globalThis.__PO_TEST_COOKIES__ = { [COOKIE]: value };
}
