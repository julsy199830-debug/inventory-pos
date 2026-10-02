"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getCashier, setCashierCookie, clearCashierCookie } from "@/lib/session";
import {
  checkRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  RATE_LIMITED_MESSAGE,
  type RateVerdict,
} from "@/lib/rate-limit";
import { PIN_PATTERN, verifyPin } from "@/lib/pin";
import { asRole, type Role, type ActionResult } from "@/lib/types";
import { recordAudit } from "@/lib/audit";

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
 * Result shape for {@link signInCashierPin} — the sign-in outcome plus the
 * caller's own role (used only for post-login routing: CASHIER → `/pos`,
 * staff → dashboard). The role is the authenticated caller's OWN role from the
 * just-verified account row — never another user's — so it exposes no staff
 * directory information beyond what the caller already proved.
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
 * account re-resolved from the submitted identifier, and re-checked for `active`
 * here — never trusting that the caller (or the login picker) ran any of it. A
 * turned-off employee (`active: false`) is rejected even though the picker only
 * listed active users, so revoking access takes effect immediately, not at the
 * next picker render (see {@link setCashierCookie} for why `active` is the
 * soft-delete gate).
 *
 * On success we set the persisted, SIGNED cookie (sign-in once, survives
 * reloads). We do NOT `revalidatePath('/pos')` here: the cookie write already
 * makes the next render dynamic (cookies are request-time), and the page reads
 * the session fresh on every navigation, so there's nothing cached to purge. The
 * client simply lets the action resolve and the gate swaps to the register.
 *
 * TWO ENTRY POINTS, ONE CORE:
 *   - {@link signInCashierPin} takes a `User.id` — kept for callers that already
 *     hold a resolved id.
 *   - {@link signInStaffPin} takes a display NAME, and is what `/login` uses. The
 *     login page is unauthenticated, so its payload must not publish internal
 *     `User.id`s — that published payload is exactly how the pre-signature cookie
 *     forgery was discovered (`src/lib/session-token.ts`). Both entry points run
 *     the same validate → throttle → resolve → verify → issue sequence below.
 */

/** Generic, leak-free failure message — identical for every rejection reason. */
const SIGN_IN_FAILED = "Incorrect employee or PIN.";

/** Longest display name accepted from the picker (bounds the lookup string). */
const MAX_NAME_LENGTH = 120;

/**
 * `User.name` is not unique, so one submitted name can match several active
 * accounts. The PIN still has to verify, and this caps how many stored hashes a
 * single attempt can cost.
 */
const MAX_NAME_CANDIDATES = 5;

/** The columns sign-in needs; `pinHash` is never copied into an audit row. */
const SIGN_IN_ACCOUNT_SELECT = {
  id: true,
  // `name` is selected so a failed attempt is attributed to a readable person
  // rather than a bare uuid, and so the audit text can name the submission.
  name: true,
  pinHash: true,
  active: true,
  role: true,
};

/** One resolved candidate account for the sign-in tail. */
type SignInAccount = {
  id: string;
  name: string;
  pinHash: string | null;
  active: boolean;
  role: string;
};

/** How the caller identified the account — used for audit wording only. */
type SubmittedIdentifier = { kind: "id" | "name"; value: string };

/**
 * Rate-limit gate shared by both entry points. Synchronous, and run BEFORE any
 * database read or scrypt work, so a throttled attempt spends no CPU and learns
 * nothing about the account from this path. The submitted identifier is used only
 * as a bucket key — the authentication decision is still made server-side.
 *
 * Returns the message to surface when throttled, else `null`.
 */
async function throttleError(
  bucketKey: string,
  submitted: SubmittedIdentifier,
  ip: string,
): Promise<string | null> {
  const verdict: RateVerdict = checkRateLimit(bucketKey, ip);
  if (verdict === "ok") return null;

  // Audited, because a burst of throttled attempts against one account is
  // exactly the thing an administrator needs to be able to see later, and it is
  // invisible everywhere else. The submitted identifier is recorded as free text
  // rather than in the `userId` foreign key, because the limiter runs BEFORE the
  // account is looked up and the identifier may not resolve to a real user.
  await recordAudit({
    action: "LOGIN_RATE_LIMITED",
    userId: null,
    entity: "User",
    summary: `Sign-in attempt throttled by the rate limiter (submitted ${submitted.kind} ${submitted.value})`,
    after: { submittedKind: submitted.kind, submittedValue: submitted.value },
  });
  return RATE_LIMITED_MESSAGE;
}

/**
 * Shared tail of both PIN entry points: decide on the already-resolved
 * candidates, then issue (or refuse) the session. Written once so the two entry
 * points cannot drift apart on security behaviour.
 */
async function resolveAndIssue(params: {
  /** Bucket key the limiter was checked with — the submitted identifier. */
  bucketKey: string;
  submitted: SubmittedIdentifier;
  /** Candidate accounts resolved from the submission (empty = unknown). */
  candidates: SignInAccount[];
  pin: string;
  ip: string;
}): Promise<SignInResult> {
  const { bucketKey, submitted, candidates, pin, ip } = params;

  // No candidate account: the shape of "wrong PIN", "no such user" and
  // "offboarded" is deliberately identical from the caller's view — one generic
  // message, so the response reveals nothing about which users exist, are active,
  // or have a malformed hash. The `active` re-check is belt-and-suspenders on top
  // of the picker only listing active users. Every one of these outcomes also
  // counts as a failed login attempt for the rate limiter (the limiter never
  // learns which kind it was, and this action never tells it).
  if (candidates.length === 0) {
    recordLoginFailure(bucketKey, ip);
    await recordAudit({
      action: "LOGIN_FAILURE",
      // NOT the submitted value in `userId`: when it doesn't resolve to a real
      // account, writing it there would violate the `AuditLog.userId` foreign key
      // and the insert — and therefore the audit row itself — would be lost. That
      // is precisely the case worth seeing, so the unresolved identifier goes in
      // the free-text snapshot instead and the FK column is left null.
      userId: null,
      actor: "Unknown account",
      entity: "User",
      summary: `Sign-in failed for an unknown or inactive account (submitted ${submitted.kind} ${submitted.value})`,
      after: {
        submittedKind: submitted.kind,
        submittedValue: submitted.value,
        knownAccount: false,
      },
    });
    return { ok: false, error: SIGN_IN_FAILED };
  }

  // Hash-ONLY verification (plaintext retirement complete): `verifyPin`
  // recomputes scrypt against the stored versioned hash with timing-safe
  // comparison and fails closed — a malformed/stale hash returns false, never
  // authenticates, and there is no plaintext fallback of any kind.
  //
  // Every candidate is tried in the deterministic order its caller supplied and
  // the FIRST hash that verifies wins, because `User.name` is not unique: two
  // active people named "Juan" must both be able to tap their name and enter
  // their own PIN. The PIN is still the only credential — a name on its own
  // authenticates nobody — and the extra work is bounded by
  // `MAX_NAME_CANDIDATES` on an attempt the limiter has already allowed.
  let match: SignInAccount | null = null;
  for (const candidate of candidates) {
    if (candidate.pinHash && (await verifyPin(pin, candidate.pinHash))) {
      match = candidate;
      break;
    }
  }

  if (!match) {
    recordLoginFailure(bucketKey, ip);
    // Attribute the failure to the account when the submission resolved to
    // exactly one — the documented, useful case ("this employee is fumbling
    // their PIN"). When a name matched several accounts we cannot know which was
    // meant, so the row stays unattributed rather than blaming a colleague.
    const blamed = candidates.length === 1 ? candidates[0] : null;
    await recordAudit({
      action: "LOGIN_FAILURE",
      userId: blamed?.id ?? null,
      actor: blamed?.name ?? "Unknown account",
      entity: "User",
      entityId: blamed?.id ?? null,
      summary: blamed
        ? "Sign-in failed (incorrect PIN)"
        : `Sign-in failed (incorrect PIN; submitted name matched ${candidates.length} accounts)`,
      after: blamed
        ? { knownAccount: true, reason: "bad-pin" }
        : { knownAccount: false, reason: "bad-pin", candidateCount: candidates.length },
    });
    return { ok: false, error: SIGN_IN_FAILED };
  }

  // A genuine sign-in clears this account's failure counter and lockout (and
  // empties this source's rolling failure window) before the session is issued —
  // success must never leave stale throttling behind.
  recordLoginSuccess(match.id, ip);

  await setCashierCookie(match.id);
  await recordAudit({
    action: "LOGIN_SUCCESS",
    userId: match.id,
    entity: "User",
    entityId: match.id,
    after: { role: asRole(match.role) },
  });
  return { ok: true, role: asRole(match.role) };
}

/**
 * Sign in with a `User.id` (see the entry-point note above).
 *
 * The id is a lookup/bucket key, NOT authentication: success still requires a PIN
 * that verifies against that account's stored hash, and an id arriving from a
 * cookie is never trusted without its signature
 * (see `src/lib/session-token.ts`).
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

  const ip = await clientIp();
  const throttleMessage = await throttleError(userId, { kind: "id", value: userId }, ip);
  if (throttleMessage) return { ok: false, error: throttleMessage };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: SIGN_IN_ACCOUNT_SELECT,
  });

  return resolveAndIssue({
    bucketKey: userId,
    submitted: { kind: "id", value: userId },
    // An inactive account is reported exactly like an unknown one (same generic
    // message, same audit shape), which is why it is dropped here instead of
    // being passed on as a candidate.
    candidates: user && user.active ? [user] : [],
    pin,
    ip,
  });
}

/**
 * Sign in with the employee's display NAME — the entry point `/login` uses.
 *
 * The login page is unauthenticated, so it publishes only names (never ids or
 * roles) and the server re-resolves the name here. That keeps the client from
 * ever naming an account by its internal identifier, while a name by itself
 * still authenticates nobody: the PIN must verify against a stored hash.
 * Resolution is exact-match and active-only, mirroring exactly the list the
 * picker rendered.
 */
export async function signInStaffPin(input: {
  name: string;
  pin: string;
}): Promise<SignInResult> {
  const name = (input.name ?? "").trim();
  const pin = (input.pin ?? "").trim();

  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Select an employee to sign in." };
  }
  if (!pin || !PIN_PATTERN.test(pin)) {
    return { ok: false, error: "PIN must be 4–6 digits." };
  }

  const ip = await clientIp();
  const throttleMessage = await throttleError(name, { kind: "name", value: name }, ip);
  if (throttleMessage) return { ok: false, error: throttleMessage };

  const candidates = await prisma.user.findMany({
    where: { name, active: true },
    // Deterministic order, so "the first hash that verifies wins" is stable
    // across runs when several active accounts share a name.
    orderBy: { createdAt: "asc" },
    take: MAX_NAME_CANDIDATES,
    select: SIGN_IN_ACCOUNT_SELECT,
  });

  return resolveAndIssue({
    bucketKey: name,
    submitted: { kind: "name", value: name },
    candidates,
    pin,
    ip,
  });
}

/**
 * Sign the current cashier out of the POS register — clears the session cookie.
 *
 * No payload and no failure mode worth surfacing: deleting a cookie that's
 * already absent is a no-op, and there's nothing else to validate. Idempotent on
 * purpose so a double-click or a stale-tab sign-out can't error out.
 */
export async function signOutCashier(): Promise<void> {
  // Resolve the actor BEFORE the cookie is cleared — afterwards the id is gone
  // and the event would be unattributable. A sign-out with no active session is
  // not an error and writes no audit row (nothing happened).
  const cashier = await getCashier();
  await clearCashierCookie();
  if (cashier) {
    await recordAudit({
      action: "LOGOUT",
      userId: cashier.id,
      actor: cashier.name,
      entity: "User",
      entityId: cashier.id,
    });
  }
}
