/**
 * Phase 1b integration tests for the physical stock count Server Action
 * (`applyStockCount` in `src/app/(dashboard)/inventory/actions.ts`).
 *
 * Run (from the project root):
 *   npx tsx tests/unit/stock-count.test.ts
 *
 * ISOLATION: identical to `po-actions.test.ts` — the suite never touches the
 * repository's real `dev.db`. It points `DATABASE_URL` at a throwaway SQLite
 * file under `test-results/stock-count-db/`, applies the project's REAL
 * migrations, seeds its own users/products, and deletes the directory at the
 * end. The `server-only` / `next/headers` / `next/cache` modules are redirected
 * through the CJS resolver before any app import, and the session cookie jar is
 * switched per scenario with `asUser()` / `signedOut()`.
 *
 * WHAT IS BEING PINNED DOWN: a stock count is the one inventory operation that
 * rewrites a quantity wholesale, so these tests assert the three properties
 * that make it safe to trust —
 *   1. only discrepant lines are written (matching lines are never logged),
 *   2. every write leaves an ADJUSTMENT ledger row with a readable reason,
 *   3. the whole sheet is atomic: a mid-count failure leaves stock untouched.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import Module from "node:module";
import path from "node:path";

declare global {
  var __PO_TEST_COOKIES__: Record<string, string> | undefined;
}

const MOCKS: Record<string, string> = {
  "server-only": path.resolve("tests/setup/mocks/server-only.cjs"),
  "next/headers": path.resolve("tests/setup/mocks/next-headers.cjs"),
  "next/cache": path.resolve("tests/setup/mocks/next-cache.cjs"),
};
const origResolve = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
(Module as unknown as { _resolveFilename: Function })._resolveFilename = function (
  request: string,
  ...rest: unknown[]
) {
  return MOCKS[request] ?? origResolve.call(this, request, ...rest);
};

const DB_DIR = path.resolve("test-results", "stock-count-db");
const DB_REL_URL = "file:./test-results/stock-count-db/stock-count.db";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    })
    .catch((e: unknown) => {
      failed += 1;
      console.error(`FAIL - ${name}: ${e instanceof Error ? e.message : String(e)}`);
    });
}

/** Build a FormData from a flat record (values stringified). */
function fd(fields: Record<string, string | number>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  return f;
}

/**
 * Build a count sheet using the repeating-field convention the action parses:
 * `lineCount`, then `productId_1`, `counted_1`, `productId_2`, `counted_2`, …
 *
 * A `null` counted value is written as an EMPTY field on purpose — that is the
 * real shape a user leaves behind by clearing a box, and it must be rejected
 * rather than silently coerced to 0 (which would zero out live stock).
 */
function countForm(
  lines: Array<[string, number | string | null]>,
  extra: Record<string, string | number> = {},
): FormData {
  const f = fd({ lineCount: lines.length, countReason: "Physical count", ...extra });
  lines.forEach(([productId, counted], i) => {
    f.append(`productId_${i + 1}`, productId);
    f.append(`counted_${i + 1}`, counted === null ? "" : String(counted));
  });
  return f;
}

function asUser(userId: string): void {
  globalThis.__PO_TEST_COOKIES__ = { "pos-cashier": userId };
}
function signedOut(): void {
  globalThis.__PO_TEST_COOKIES__ = {};
}

async function main(): Promise<void> {
  // ── Throwaway database: the project's REAL migrations, test-only data ─────
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });
  process.env.DATABASE_URL = DB_REL_URL;

  const mig = spawnSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
    env: { ...process.env, DATABASE_URL: DB_REL_URL },
  });
  if (mig.status !== 0) {
    console.error(mig.stdout, mig.stderr);
    throw new Error(`prisma migrate deploy failed on the throwaway test DB (${mig.status})`);
  }

  // Dynamic imports — hooks + DATABASE_URL above must be in place first.
  const { prisma } = await import("@/lib/db");
  const { hashPin } = await import("@/lib/pin");
  const { applyStockCount } = await import("@/app/(dashboard)/inventory/actions");

  // ── Fixtures (test-only users/products on the throwaway DB) ───────────────
  const ADMIN = "u-sc-admin";
  const MANAGER = "u-sc-manager";
  const CASHIER = "u-sc-cashier";
  for (const [id, name, role, pin] of [
    [ADMIN, "Count Admin", "ADMIN", "1234"],
    [MANAGER, "Count Manager", "MANAGER", "2345"],
    [CASHIER, "Count Cashier", "CASHIER", "3456"],
  ] as const) {
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${name.toLowerCase().replace(/ /g, ".")}@stock-count.test`,
        passwordHash: "test-only-not-used",
        pinHash: await hashPin(pin),
        role,
        active: true,
      },
    });
  }

  /**
   * Fresh product per scenario so tests can't contaminate each other's stock
   * levels through shared mutable state.
   */
  async function makeProduct(sku: string, stock: number): Promise<string> {
    const p = await prisma.product.create({
      data: { name: `Count Widget ${sku}`, sku, price: 10, cost: 4, stock },
    });
    return p.id;
  }

  const stockOf = (id: string): Promise<number> =>
    prisma.product.findUniqueOrThrow({ where: { id } }).then((p) => p.stock);
  const movementsFor = (
    id: string,
  ): Promise<Array<{ quantityChange: number; type: string; reason: string | null }>> =>
    prisma.stockMovement
      .findMany({ where: { productId: id } })
      .then((rows) =>
        rows.map((r) => ({
          quantityChange: r.quantityChange,
          type: r.type,
          reason: r.reason,
        })),
      );
  const movementCount = (): Promise<number> => prisma.stockMovement.count();

  asUser(ADMIN);
  // ══ 1. RECONCILIATION: matching vs discrepant lines ════════════════════════
  await check("1. all lines match: nothing written, counted as reconciled", async () => {
    const a = await makeProduct("SC-MATCH-A", 10);
    const b = await makeProduct("SC-MATCH-B", 3);
    const res = await applyStockCount(countForm([[a, 10], [b, 3]]));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.applied, 0, "no adjustments");
    assert.equal(res.data.matched, 2, "both lines reconciled");
    assert.equal(res.data.netChange, 0);
    assert.equal(await stockOf(a), 10, "stock untouched");
    assert.equal(await movementCount(), 0, "matching lines are NOT logged — keeps the ledger signal-dense");
  });

  await check("2. negative variance (shrink) lowers stock and logs a negative ADJUSTMENT", async () => {
    const id = await makeProduct("SC-SHRINK", 20);
    const res = await applyStockCount(countForm([[id, 17]], { countReason: "Shrinkage / theft" }));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.applied, 1);
    assert.equal(res.data.matched, 0);
    assert.equal(res.data.netChange, -3);
    assert.equal(await stockOf(id), 17, "stock set to the counted quantity");
    assert.deepEqual(await movementsFor(id), [
      { quantityChange: -3, type: "ADJUSTMENT", reason: "Stock count: Shrinkage / theft" },
    ]);
  });

  await check("3. positive variance (found stock) raises stock and logs a positive ADJUSTMENT", async () => {
    const id = await makeProduct("SC-FOUND", 5);
    const res = await applyStockCount(countForm([[id, 9]], { countReason: "Found stock" }));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.netChange, 4);
    assert.equal(await stockOf(id), 9);
    assert.deepEqual(await movementsFor(id), [
      { quantityChange: 4, type: "ADJUSTMENT", reason: "Stock count: Found stock" },
    ]);
  });

  await check("4. counting down to exactly zero is a legitimate variance", async () => {
    const id = await makeProduct("SC-ZERO", 6);
    const res = await applyStockCount(countForm([[id, 0]]));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.netChange, -6);
    assert.equal(await stockOf(id), 0, "zero is a real count, not a missing value");
    assert.equal((await movementsFor(id))[0].quantityChange, -6);
  });

  await check("5. mixed sheet: only discrepant lines are written, matches counted but not logged", async () => {
    const same = await makeProduct("SC-MIX-SAME", 4);
    const down = await makeProduct("SC-MIX-DOWN", 10);
    const up = await makeProduct("SC-MIX-UP", 2);
    const before = await movementCount();
    const res = await applyStockCount(
      countForm([
        [same, 4],
        [down, 8],
        [up, 7],
      ]),
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.matched, 1);
    assert.equal(res.data.applied, 2);
    assert.equal(res.data.netChange, -2 + 5, "net is the sum of signed deltas");
    assert.equal(await movementCount(), before + 2, "exactly two ledger rows for two variances");
    assert.deepEqual(await movementsFor(same), [], "matching line produced no movement");
    assert.equal((await movementsFor(down))[0].quantityChange, -2);
    assert.equal((await movementsFor(up))[0].quantityChange, 5);
  });

  // ══ 2. VALIDATION: bad input must never reach the ledger ═════════════════
  await check("6. negative / fractional / non-numeric counted quantities are rejected", async () => {
    const id = await makeProduct("SC-BADQTY", 12);
    const before = await movementCount();
    for (const bad of [-1, 2.5, "abc"]) {
      const res = await applyStockCount(countForm([[id, bad]]));
      assert.equal(res.ok, false, `counted=${bad} must be rejected`);
      assert.ok(
        !res.ok && /whole numbers of 0 or more/.test(res.error),
        `counted=${bad}: ${!res.ok ? res.error : ""}`,
      );
    }
    assert.equal(await stockOf(id), 12, "stock never changed by a rejected sheet");
    assert.equal(await movementCount(), before, "no ledger rows from rejected sheets");
  });

  await check("7. a BLANK counted quantity is rejected, not read as zero", async () => {
    const id = await makeProduct("SC-BLANK", 25);
    const res = await applyStockCount(countForm([[id, null]]));
    assert.equal(res.ok, false, "an emptied box must not zero out live stock");
    assert.ok(!res.ok && /whole numbers of 0 or more/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await stockOf(id), 25, "the 25 units are still on the shelf");
  });

  await check("8. one bad line rejects the WHOLE sheet (no partial application)", async () => {
    const good = await makeProduct("SC-ATOMIC-GOOD", 8);
    const bad = await makeProduct("SC-ATOMIC-BAD", 8);
    const res = await applyStockCount(
      countForm([
        [good, 3],
        [bad, -1],
      ]),
    );
    assert.equal(res.ok, false);
    assert.equal(await stockOf(good), 8, "the valid leading line was NOT written");
    assert.equal(await stockOf(bad), 8);
  });

  await check("9. an empty sheet is rejected", async () => {
    const zero = await applyStockCount(countForm([]));
    assert.equal(zero.ok, false);
    assert.ok(!zero.ok && /count sheet is empty/.test(zero.error), !zero.ok ? zero.error : "");
    const missing = await applyStockCount(fd({}));
    assert.equal(missing.ok, false);
    const noLines = await applyStockCount(fd({ lineCount: 2, productId_1: "", counted_1: "" }));
    assert.equal(noLines.ok, false, "lines without a productId are skipped, leaving nothing to apply");
  });

  await check("10. an oversized sheet is rejected before any write", async () => {
    const id = await makeProduct("SC-HUGE", 3);
    const f = fd({ lineCount: 1001, countReason: "Physical count" });
    for (let i = 1; i <= 1001; i++) {
      f.append(`productId_${i}`, id);
      f.append(`counted_${i}`, "1");
    }
    const res = await applyStockCount(f);
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /too large/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await stockOf(id), 3, "no write from an over-limit sheet");
  });

  // ══ 3. CONCURRENCY: products deleted mid-count ════════════════════════════
  await check("11. a product deleted before submit is skipped, not fatal", async () => {
    const alive = await makeProduct("SC-RACE-ALIVE", 10);
    const doomed = await makeProduct("SC-RACE-DOOMED", 10);
    // Simulates the sheet being rendered, then someone deleting a row before
    // the counter hits Apply. A reconciliation must not abort wholesale.
    await prisma.product.delete({ where: { id: doomed } });
    const res = await applyStockCount(
      countForm([
        [alive, 6],
        [doomed, 1],
      ]),
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.applied, 1, "only the surviving product was adjusted");
    assert.equal(await stockOf(alive), 6);
    assert.equal(await prisma.product.count({ where: { id: doomed } }), 0, "not resurrected");
  });

  await check("12. a product deleted for EVERY line still succeeds with zero applied", async () => {
    const doomed = await makeProduct("SC-ALLGONE", 5);
    await prisma.product.delete({ where: { id: doomed } });
    const res = await applyStockCount(countForm([[doomed, 1]]));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.applied, 0);
    assert.equal(res.data.matched, 0, "a skipped line is neither a match nor a variance");
  });

  // ══ 4. ATOMICITY: a mid-count failure must roll the whole sheet back ══════
  await check("13. a failure part-way through leaves NO partial writes (transaction rollback)", async () => {
    const first = await makeProduct("SC-ROLLBACK-1", 50);
    const boom = await makeProduct("SC-ROLLBACK-2", 50);
    const third = await makeProduct("SC-ROLLBACK-3", 50);
    const before = await movementCount();

    // Line 1 is a perfectly valid shrink and WOULD be written — if the
    // transaction is real. We then make line 2's own write fail at the database
    // level with a BEFORE UPDATE trigger that aborts, which the action has no
    // way to anticipate or special-case. If the writes were not atomic, line 1
    // would survive; with a real transaction everything rolls back.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER sc_boom BEFORE UPDATE ON Product
       WHEN NEW.id = '${boom}'
       BEGIN SELECT RAISE(ABORT, 'forced mid-count failure'); END;`,
    );

    const res = await applyStockCount(
      countForm([
        [first, 40],
        [boom, 40],
        [third, 40],
      ]),
    );
    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS sc_boom;");

    assert.equal(res.ok, false, "the count reports failure");
    assert.ok(!res.ok && /Could not apply/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await stockOf(first), 50, "line 1 was rolled back, not half-applied");
    assert.equal(await stockOf(boom), 50);
    assert.equal(await stockOf(third), 50, "line 3 never ran");
    assert.equal(await movementCount(), before, "zero ledger rows survived the rollback");
  });

  // ══ 5. PERMISSIONS ════════════════════════════════════════════════════════
  await check("14. CASHIER is rejected server-side", async () => {
    const id = await makeProduct("SC-PERM", 12);
    asUser(CASHIER);
    const res = await applyStockCount(countForm([[id, 1]]));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /permission/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await stockOf(id), 12, "no write from an unauthorized count");
  });

  await check("15. signed-out caller is rejected server-side", async () => {
    const id = await makeProduct("SC-PERM-OUT", 12);
    signedOut();
    const res = await applyStockCount(countForm([[id, 1]]));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /signed in/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await stockOf(id), 12);
  });

  await check("16. MANAGER may apply a count (staff gate succeeds for MANAGER)", async () => {
    const id = await makeProduct("SC-MGR", 10);
    asUser(MANAGER);
    const res = await applyStockCount(countForm([[id, 4]]));
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(await stockOf(id), 4);
  });

  // ══ 6. LEDGER INTEGRITY ═══════════════════════════════════════════════════
  await check("17. the reason is recorded and prefixed so ledger rows stay readable", async () => {
    const id = await makeProduct("SC-REASON", 10);
    asUser(ADMIN);
    await applyStockCount(countForm([[id, 8]], { countReason: "Damaged or expired" }));
    const mv = await movementsFor(id);
    assert.equal(mv.length, 1);
    assert.match(mv[0].reason ?? "", /^Stock count: Damaged or expired$/);
  });

  await check("18. a missing reason still yields an auditable, non-null note", async () => {
    const id = await makeProduct("SC-NOREASON", 10);
    await applyStockCount(countForm([[id, 8]], { countReason: "" }));
    const mv = await movementsFor(id);
    assert.equal(mv[0].reason, "Stock count: Physical count", "falls back to a default reason");
  });

  await check("19. repeated counts compound rather than overwrite the ledger", async () => {
    const id = await makeProduct("SC-REPEAT", 10);
    await applyStockCount(countForm([[id, 8]]));
    await applyStockCount(countForm([[id, 5]]));
    await applyStockCount(countForm([[id, 5]]));
    assert.equal(await stockOf(id), 5);
    const mv = (await movementsFor(id)).map((m) => m.quantityChange).sort((a, b) => a - b);
    assert.deepEqual(mv, [-3, -2], "two adjustments (10→8 = -2, then 8→5 = -3); the third count matched and was not logged");
  });

  console.log(`\nStock count action tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;

  // ── Cleanup: drop the throwaway database ──────────────────────────────────
  await prisma.$disconnect();
  try {
    rmSync(DB_DIR, { recursive: true, force: true });
  } catch {
    console.log("note: temp test DB left in place (Windows file lock) — safe to delete manually");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
