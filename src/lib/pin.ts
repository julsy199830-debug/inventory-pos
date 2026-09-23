/**
 * The login-PIN shape rule, shared by every place that validates a cashier PIN,
 * plus the versioned scrypt hashing used to store it.
 *
 * 4–6 digits, nothing else, kept as a string (not a number) so leading zeros
 * are preserved — a "0123" PIN must not collapse to "123" (see the `User.pin`
 * schema comment). Kept here at the library layer — not the Prisma schema —
 * because SQLite stores `pin` as a plain `String` and the schema only commits
 * the shape, exactly like `Sale.status` / `User.role`: the column holds the
 * literal and the set of allowed values is enforced at the TypeScript layer.
 *
 * Re-exported from the Employees and POS action files so there's a single
 * source of truth for the rule across create-employee, edit-employee, and
 * cashier sign-in.
 */
export const PIN_PATTERN = /^\d{4,6}$/;

// ── PIN hashing ──────────────────────────────────────────────────────────────
//
// The PIN hash is the account's only long-lived credential after the plaintext
// retirement (migration `20260921103000_retire_plaintext_pin`): `User.pin`
// keeps the shape rule for UX, but verification always goes through `pinHash`.
//
// Stored format (versioned, self-describing, KDF parameters in-band):
//
//   scrypt$v1$<N>$<r>$<p>$<salt 32 hex>$<derived key 128 hex>
//
//   - scrypt from node:crypto, N=16384 (2^14), r=8, p=1, keylen=64 — about
//     16 MiB per hash, comfortably inside Node's default 32 MiB maxmem
//   - 16 random salt bytes per hash (crypto.randomBytes), hex-encoded
//   - the version tag lets a future parameter bump migrate old rows without
//     re-formatting the ones that are still valid
//
// `verifyPin` fails CLOSED: a malformed, out-of-range, or unknown-version
// stored value returns `false` — it never throws and never falls back to
// plaintext comparison, so a corrupt row can only lock an account, never open
// it. `isHashedPin` runs the same strict validation synchronously so callers
// (e.g. scripts/hash-existing-pins.ts) can classify rows without hashing.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/** Current KDF parameters — the only set v1 emits. */
const SCRYPT_N = 16384; // 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;
/** Derived key length: 64 bytes → 128 hex chars. */
const KEY_LEN = 64;
/** Salt length: 16 bytes → 32 hex chars. */
const SALT_LEN = 16;
/** Node's default `maxmem`; 128·N·r must stay within it. */
const MAX_MEM = 32 * 1024 * 1024;

const SALT_HEX = /^[0-9a-f]{32}$/;
const KEY_HEX = /^[0-9a-f]{128}$/;

function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

/**
 * Validate the numeric KDF parameters embedded in a stored v1 hash. v1 emits
 * N=16384/r=8/p=1; anything outside the accepted envelope is treated as
 * malformed so a hostile or corrupt row can never drive scrypt into an
 * extreme configuration.
 */
function paramsInRange(N: number, r: number, p: number): boolean {
  return (
    isPowerOfTwo(N) &&
    N >= SCRYPT_N &&
    N <= 1048576 && // 2^20 — far past any sane configuration
    r >= 1 &&
    r <= 16 &&
    p >= 1 &&
    p <= 8 &&
    128 * N * r <= MAX_MEM
  );
}

/** Promisified scrypt wrapper — callback API → one awaited Promise per hash. */
function scryptAsync(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, KEY_LEN, { N, r, p, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Hash a PIN into the versioned v1 format. Rejects (never resolves) for input
 * failing {@link PIN_PATTERN} — callers validate the shape in the UI, but the
 * hash layer is the last line of defense for the 4–6 digit rule.
 */
export async function hashPin(pin: string): Promise<string> {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error("PIN must be 4–6 digits.");
  }
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(pin, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    "scrypt$v1",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    key.toString("hex"),
  ].join("$");
}

/**
 * True when `stored` is a structurally valid v1 hash: correct algorithm and
 * version, hex salt and derived key of the right length, and KDF parameters
 * this build accepts. Pure format/parameter check — no hashing runs.
 */
export function isHashedPin(stored: string): boolean {
  return parseStoredHash(stored) !== null;
}

/**
 * Parse and fully validate a stored hash. Returns the decoded salt, expected
 * key, and parameters, or null when anything is malformed — the single source
 * of truth both `isHashedPin` and `verifyPin` fail closed on.
 */
function parseStoredHash(stored: string): {
  salt: Buffer;
  expected: Buffer;
  N: number;
  r: number;
  p: number;
} | null {
  const parts = stored.split("$");
  if (parts.length !== 7) return null;
  const [algo, version, nStr, rStr, pStr, saltHex, keyHex] = parts;
  if (algo !== "scrypt" || version !== "v1") return null;
  if (!/^\d+$/.test(nStr) || !/^\d+$/.test(rStr) || !/^\d+$/.test(pStr)) {
    return null;
  }
  if (!SALT_HEX.test(saltHex) || !KEY_HEX.test(keyHex)) return null;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!paramsInRange(N, r, p)) return null;
  return {
    salt: Buffer.from(saltHex, "hex"),
    expected: Buffer.from(keyHex, "hex"),
    N,
    r,
    p,
  };
}

/**
 * Constant-time PIN verification against a stored v1 hash. Fails closed: a
 * malformed stored value (or a hashing error) returns `false` — it never
 * throws and never compares against plaintext.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  try {
    const actual = await scryptAsync(pin, parsed.salt, parsed.N, parsed.r, parsed.p);
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

