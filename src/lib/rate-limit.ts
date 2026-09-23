/**
 * In-memory login rate limiting for POS PIN sign-in.
 *
 * WHY MEMORY ONLY: this app is a single-Node-process deployment on a local
 * SQLite database (`next start -H 0.0.0.0`, one `dev.db`). A process-local
 * limiter adds brute-force protection with zero schema changes, zero
 * per-attempt disk writes, and no new dependency. The tradeoffs are documented
 * below (restart clears state; multiple processes would each have their own
 * state).
 *
 * A 4–6 digit PIN has a tiny search space (≤ 1,100,000), so hashing alone can
 * never stop online guessing — this limiter is the second, mandatory layer
 * (the first being the scrypt hash itself). Two independent dimensions:
 *
 *   - PER-USER: stops a targeted brute force against one employee account.
 *     4 failed attempts allowed; the 5th failure starts a cooldown that
 *     escalates (15 → 30 → 60 minutes) each time the account is re-locked.
 *     Never permanent — a legitimate employee who fat-fingers their PIN is
 *     merely delayed, and their very next SUCCESS resets everything.
 *   - PER-IP: stops cycling through every listed employee from one machine
 *     (select A, try 3 PINs, select B, repeat). Rolling 5-minute window,
 *     20 failures max, then a short 2-minute throttle — deliberately much
 *     shorter than the user cooldown because one workstation is shared by
 *     several staff and must never become a long outage.
 *
 * POLICY VALUES live in the constants block below and nowhere else.
 *
 * SECURITY NOTES:
 *   - Checks are synchronous and happen BEFORE any database read or scrypt
 *     verification in `signInCashierPin`, so a throttled attacker consumes no
 *     CPU and gets no oracle about the account.
 *   - Every response text here is intentionally generic — nothing reveals
 *     remaining attempts, counter values, account existence, or hash state.
 *   - Never log PINs, hashes, or salts (this module has no logging at all).
 *
 * LIMITATIONS (documented, not hidden):
 *   - State is PROCESS-LOCAL: restarting the Node process clears all counters
 *     (the attacker loses their progress too). If this app is ever scaled to
 *     multiple Node processes/instances, each would keep separate state —
 *     migrate to shared storage (e.g. a DB-backed table) at that point. Do NOT
 *     solve that now: single-process is the current and intended deployment.
 *   - The per-IP key is best-effort (see `clientIp` in `pos/actions.ts`): in a
 *     plain LAN deployment with no reverse proxy there is no trustworthy
 *     client IP inside a Server Action, so all direct clients share one
 *     fallback bucket. Thresholds are sized so that shared bucket never
 *     blocks normal staff usage.
 */

/** ── Policy constants (the only place to tune the limiter) ──────────────── */

/** Failed PIN attempts allowed per user before the cooldown starts. */
export const USER_MAX_FAILURES = 4;

/** First cooldown duration for a locked user account (ms). */
export const USER_COOLDOWN_BASE_MS = 15 * 60 * 1000; // 15 minutes

/** Cooldown ceiling for repeatedly re-locked accounts (ms). */
export const USER_COOLDOWN_MAX_MS = 60 * 60 * 1000; // 60 minutes

/** Extra cooldown each successive lockout adds, capped at the ceiling. */
export const USER_COOLDOWN_STEP_MS = 15 * 60 * 1000;

/** Rolling window for the per-IP failure counter (ms). */
export const IP_WINDOW_MS = 5 * 60 * 1000;

/** Failures allowed from one IP within {@link IP_WINDOW_MS}. */
export const IP_MAX_FAILURES = 20;

/** Throttle duration once an IP trips {@link IP_MAX_FAILURES} (ms). */
export const IP_COOLDOWN_MS = 2 * 60 * 1000;

/** Hard cap on tracked keys per dimension — bounded memory, see `prune`. */
export const MAX_TRACKED_KEYS = 1_000;

/** Stale-entry age: records older than this are prunable (ms). */
const STALE_MS = Math.max(USER_COOLDOWN_MAX_MS, IP_WINDOW_MS) * 2;

/** Safe public message while a throttle is active. Deliberately vague. */
export const RATE_LIMITED_MESSAGE = "Too many attempts. Try again shortly.";

/** Verdict returned by {@link checkRateLimit}. */
export type RateVerdict = "ok" | "user-locked" | "ip-throttled";

/** ── Internal state (module scope — one instance per Node process) ──────── */

type UserRecord = {
  /** Consecutive failed attempts since the last success/reset. */
  failures: number;
  /** Epoch ms until which the account is locked; 0 when not locked. */
  lockedUntil: number;
  /** How many times the account has been locked (drives escalation). */
  lockCount: number;
  /** Last activity epoch ms — drives stale pruning. */
  lastSeen: number;
};

type IpRecord = {
  /** Failure timestamps inside the rolling window (pruned on access). */
  failures: number[];
  /** Epoch ms until which the IP is throttled; 0 when not throttled. */
  throttledUntil: number;
  /** Last activity epoch ms — drives stale pruning. */
  lastSeen: number;
};

const userState = new Map<string, UserRecord>();
const ipState = new Map<string, IpRecord>();

/**
 * Injectable clock so tests can exercise cooldown expiry without sleeping.
 * Production always uses `Date.now`; only the unit tests swap it.
 */
let clock: () => number = () => Date.now();

/** Test seam: replace the clock (pass the real one to restore). */
export function setClock(fn: () => number): void {
  clock = fn;
}

/**
 * Drop records that can no longer influence any decision: user rows whose
 * lockout long expired, IP rows with no recent failures and no active
 * throttle. Runs on every call — O(keys), and the maps are capped at
 * {@link MAX_TRACKED_KEYS}, so this stays microseconds. Also enforces the
 * hard cap by evicting oldest-seen entries, so a flood of synthetic ids cannot
 * grow the process unboundedly.
 */
function prune(now: number): void {
  for (const [key, rec] of userState) {
    if (now - rec.lastSeen > STALE_MS && rec.lockedUntil <= now) {
      userState.delete(key);
    }
  }
  for (const [key, rec] of ipState) {
    // Drop timestamps that have fallen out of the rolling window here too —
    // `recordLoginFailure` filters on access, but an IP that fails a few times
    // and never returns would otherwise retain its record forever.
    if (rec.failures.length > 0) {
      rec.failures = rec.failures.filter((t) => now - t <= IP_WINDOW_MS);
    }
    if (
      now - rec.lastSeen > STALE_MS &&
      rec.throttledUntil <= now &&
      rec.failures.length === 0
    ) {
      ipState.delete(key);
    }
  }
  for (const map of [userState, ipState]) {
    while (map.size > MAX_TRACKED_KEYS) {
      let oldestKey: string | null = null;
      let oldestSeen = Infinity;
      for (const [key, rec] of map) {
        if (rec.lastSeen < oldestSeen) {
          oldestSeen = rec.lastSeen;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      map.delete(oldestKey);
    }
  }
}

/** ── Public API (synchronous — safe to call before any await) ────────────── */

/**
 * Decide whether a sign-in attempt for `userId` from `ip` may proceed.
 *
 * Synchronous by design: `signInCashierPin` calls this BEFORE the user lookup
 * and BEFORE any scrypt verification, so a throttled request performs zero
 * database work and zero key derivation.
 *
 * Neither dimension alone is the security boundary (the client controls
 * `userId`, and absent a proxy the IP too) — together they raise the cost of
 * online brute force from ~10⁶ tries to ~5 tries per 15+ minutes per account
 * and ~20 per 5 minutes per source.
 */
export function checkRateLimit(userId: string, ip: string): RateVerdict {
  const now = clock();
  prune(now);

  const user = userState.get(userId);
  if (user && user.lockedUntil > now) return "user-locked";

  const entry = ipState.get(ip);
  if (entry && entry.throttledUntil > now) return "ip-throttled";

  return "ok";
}

/**
 * Record one failed authentication attempt (wrong PIN, unknown user id, or
 * inactive account — callers deliberately do not distinguish). The per-user
 * counter climbs toward {@link USER_MAX_FAILURES}; crossing it starts the
 * escalating cooldown. The per-IP rolling window gains a timestamp; tripping
 * {@link IP_MAX_FAILURES} starts the short IP throttle. Failures DURING an
 * active user cooldown are not counted — verification is skipped anyway, so
 * counting them would only punish a returning employee after the lock lifts.
 */
export function recordLoginFailure(userId: string, ip: string): void {
  const now = clock();
  prune(now);

  const user = userState.get(userId) ?? {
    failures: 0,
    lockedUntil: 0,
    lockCount: 0,
    lastSeen: now,
  };
  user.lastSeen = now;
  if (user.lockedUntil <= now) {
    user.failures += 1;
    if (user.failures > USER_MAX_FAILURES) {
      user.lockCount += 1;
      const step = Math.min(
        (user.lockCount - 1) * USER_COOLDOWN_STEP_MS,
        USER_COOLDOWN_MAX_MS - USER_COOLDOWN_BASE_MS,
      );
      user.lockedUntil = now + USER_COOLDOWN_BASE_MS + Math.max(0, step);
      user.failures = 0; // the cooldown governs now; count fresh after it
    }
  }
  userState.set(userId, user);

  const entry = ipState.get(ip) ?? {
    failures: [] as number[],
    throttledUntil: 0,
    lastSeen: now,
  };
  entry.lastSeen = now;
  // Keep only timestamps inside the rolling window.
  entry.failures = entry.failures.filter((t) => now - t <= IP_WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= IP_MAX_FAILURES) {
    entry.throttledUntil = now + IP_COOLDOWN_MS;
    entry.failures = []; // the throttle governs now; window restarts after
  }
  ipState.set(ip, entry);
}

/**
 * Clear a successful account's state: its failure counter and lockout are
 * dropped entirely, and this IP's rolling failure window and throttle are
 * emptied — a genuine sign-in proves the source is legitimate staff, and a
 * success must not leave stale counters behind (§6 of the stage brief).
 * OTHER users' records are untouched.
 */
export function recordLoginSuccess(userId: string, ip: string): void {
  const now = clock();
  userState.delete(userId);
  const entry = ipState.get(ip);
  if (entry) {
    entry.lastSeen = now;
    entry.failures = [];
    entry.throttledUntil = 0;
  }
}

/** Test/diagnostic seam: current tracked-key counts (no secrets exposed). */
export function trackedKeyCounts(): { users: number; ips: number } {
  return { users: userState.size, ips: ipState.size };
}

/** Test seam: clear ALL limiter state (unit tests start from a blank slate). */
export function resetRateLimiter(): void {
  userState.clear();
  ipState.clear();
  clock = () => Date.now();
}

