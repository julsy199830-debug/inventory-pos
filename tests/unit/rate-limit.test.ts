/**
 * Unit tests for the in-memory login rate limiter (`src/lib/rate-limit.ts`).
 *
 * Run with the project's plain script runner (same style as pin-hash.test.ts):
 *   npx tsx tests/unit/rate-limit.test.ts
 *
 * All time is INJECTED via `setClock()` — no real sleeps anywhere, so the
 * escalating-cooldown (15 min) and IP-window (5 min) policies are exercised in
 * milliseconds of virtual time. Every case starts from `resetRateLimiter()`.
 */
import {
  checkRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  resetRateLimiter,
  setClock,
  trackedKeyCounts,
  USER_MAX_FAILURES,
  IP_MAX_FAILURES,
  type RateVerdict,
} from "../../src/lib/rate-limit";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`ok - ${name}`);
    })
    .catch((e: unknown) => {
      failed++;
      console.error(`FAIL - ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });
}

function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(msg ?? "assertion failed");
}

function eq(a: unknown, b: unknown, msg?: string): void {
  assert(a === b, `${msg ?? "values differ"}: ${String(a)} !== ${String(b)}`);
}

/** Virtual time source: the limiter's clock reads this mutable variable. */
let now = 1_000_000;

const U = "user-A";
const U2 = "user-B";
const IP = "10.0.0.1";
const IP2 = "10.0.0.2";

async function main(): Promise<void> {
  // ── Test 1: initial requests are allowed ────────────────────────────────
  await check("initial requests are allowed", () => {
    resetRateLimiter();
    setClock(() => now);
    eq(checkRateLimit(U, IP), "ok");
    eq(checkRateLimit(U2, IP), "ok");
  });

  // ── Test 2: failures increment the user counter ─────────────────────────
  // 4 allowed failures, and the 5th attempt is refused as user-locked.
  await check("failed attempts increment the user counter", () => {
    resetRateLimiter();
    setClock(() => now);
    for (let i = 0; i < USER_MAX_FAILURES; i++) {
      recordLoginFailure(U, IP);
      eq(checkRateLimit(U, IP), "ok", `failure ${i + 1} should still allow`);
    }
    recordLoginFailure(U, IP); // 5th failure crosses the threshold
    eq(checkRateLimit(U, IP), "user-locked");
  });

  // ── Test 3: first USER_MAX_FAILURES failures remain allowed ─────────────
  await check(`first ${USER_MAX_FAILURES} failures remain allowed`, () => {
    resetRateLimiter();
    setClock(() => now);
    const verdicts: RateVerdict[] = [];
    for (let i = 0; i < USER_MAX_FAILURES; i++) {
      recordLoginFailure(U, IP);
      verdicts.push(checkRateLimit(U, IP));
    }
    assert(verdicts.every((v) => v === "ok"), "all pre-threshold verdicts must be ok");
  });

  // ── Test 4: the (USER_MAX_FAILURES+1)th failure triggers cooldown ───────
  await check("5th failure triggers cooldown", () => {
    resetRateLimiter();
    setClock(() => now);
    for (let i = 0; i < USER_MAX_FAILURES; i++) recordLoginFailure(U, IP);
    recordLoginFailure(U, IP); // the locking failure
    eq(checkRateLimit(U, IP), "user-locked");
  });

  // ── Test 5: requests during cooldown are blocked ────────────────────────
  await check("requests during cooldown are blocked", () => {
    resetRateLimiter();
    setClock(() => now);
    for (let i = 0; i <= USER_MAX_FAILURES; i++) recordLoginFailure(U, IP);
    now += 60_000; // inside the 15-minute cooldown
    eq(checkRateLimit(U, IP), "user-locked");
    now += 240_000;
    eq(checkRateLimit(U, IP), "user-locked");
  });

  // ── Test 6: cooldown expires and login is allowed again ─────────────────
  await check("cooldown expires and login is allowed again", () => {
    resetRateLimiter();
    setClock(() => now);
    for (let i = 0; i <= USER_MAX_FAILURES; i++) recordLoginFailure(U, IP);
    eq(checkRateLimit(U, IP), "user-locked");
    now += 15 * 60 * 1000 + 1; // base cooldown + 1ms of virtual time
    eq(checkRateLimit(U, IP), "ok", "post-cooldown verdict must be ok");
  });

  // ── Test 7: successful login resets the user's failed-attempt state ─────
  await check("successful login resets the user's state", () => {
    resetRateLimiter();
    setClock(() => now);
    for (let i = 0; i < USER_MAX_FAILURES - 1; i++) recordLoginFailure(U, IP);
    recordLoginSuccess(U, IP);
    // With the counter cleared, a full fresh run of failures is needed before
    // any lock; had the old count been retained, one failure would already lock.
    for (let i = 0; i < USER_MAX_FAILURES; i++) {
      recordLoginFailure(U, IP);
      eq(checkRateLimit(U, IP), "ok", `post-reset failure ${i + 1} must allow`);
    }
    recordLoginFailure(U, IP);
    eq(checkRateLimit(U, IP), "user-locked", "counter restarts from zero after success");
  });

  // ── Test 8: one throttled user does not throttle another ────────────────
  await check("one throttled user does not throttle another", () => {
    resetRateLimiter();
    setClock(() => now);
    for (let i = 0; i <= USER_MAX_FAILURES; i++) recordLoginFailure(U, IP);
    eq(checkRateLimit(U, IP), "user-locked");
    eq(checkRateLimit(U2, IP), "ok", "different user, same IP: not locked");
    eq(checkRateLimit(U2, IP2), "ok", "different user and IP: not locked");
  });

  // ── Test 9: one IP cycling through users trips IP protection ────────────
  await check("IP cycling through users trips IP protection", () => {
    resetRateLimiter();
    setClock(() => now);
    // Alternate users and stay under the per-user threshold: IP_MAX_FAILURES
    // spread over USER_MAX_FAILURES+1 accounts keeps every user bucket clean
    // while the shared IP bucket crosses the IP threshold.
    for (let i = 0; i < IP_MAX_FAILURES; i++) {
      recordLoginFailure(`user-${i % (USER_MAX_FAILURES + 1)}`, IP);
    }
    eq(checkRateLimit(U, IP), "ip-throttled");
    eq(checkRateLimit(U2, IP), "ip-throttled", "IP throttle applies to every user");
  });

  // ── Test 10: different IPs do not share per-IP state ────────────────────
  await check("different IPs do not share per-IP state", () => {
    resetRateLimiter();
    setClock(() => now);
    // Trip the IP threshold on IP only, keeping the user bucket below its own
    // threshold (20 IP failures vs 4 allowed user failures — use fresh ids).
    for (let i = 0; i < IP_MAX_FAILURES; i++) {
      recordLoginFailure(`user-${i % (USER_MAX_FAILURES + 1)}`, IP);
    }
    eq(checkRateLimit(U, IP), "ip-throttled");
    eq(checkRateLimit(U, IP2), "ok", "second IP is untouched");
  });

  // ── Test 11: stale entries are pruned ───────────────────────────────────
  await check("stale entries are pruned", () => {
    resetRateLimiter();
    setClock(() => now);
    recordLoginFailure(U, IP);
    recordLoginFailure(U2, IP2);
    eq(trackedKeyCounts().users, 2);
    eq(trackedKeyCounts().ips, 2);
    now += 2 * 60 * 60 * 1000 + 1; // beyond every retention horizon
    checkRateLimit(U, IP); // any call runs prune()
    eq(trackedKeyCounts().users, 0, "stale user records pruned");
    eq(trackedKeyCounts().ips, 0, "stale IP records pruned");
  });

  // ── Test 12: throttle verdict precedes any verification work ────────────
  await check("throttling is checked before verification (verdict, not throw)", () => {
    resetRateLimiter();
    setClock(() => now);
    for (let i = 0; i <= USER_MAX_FAILURES; i++) recordLoginFailure(U, IP);
    // The real action consults checkRateLimit BEFORE prisma/scrypt; a locked
    // verdict means verifyPin would never run. Also assert opaque-key safety.
    eq(checkRateLimit(U, IP), "user-locked");
    eq(checkRateLimit("", IP), "ok", "empty id is a distinct key, no crash");
    eq(checkRateLimit(U2, ""), "ok", "empty ip is a distinct key, no crash");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();

