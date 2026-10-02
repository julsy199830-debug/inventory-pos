/** Direct authorization tests for management reader Server Actions. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { signSessionValue } from "@/lib/session-token";

const MOCKS: Record<string, string> = {
  "server-only": path.resolve("tests/setup/mocks/server-only.cjs"),
  "next/headers": path.resolve("tests/setup/mocks/next-headers.cjs"),
  "next/cache": path.resolve("tests/setup/mocks/next-cache.cjs"),
};
/**
 * The signature of Node's internal `Module._resolveFilename`, which this
 * harness monkey-patches to redirect Next.js server-only imports at the mocks
 * above.
 *
 * Typed explicitly rather than as `Function`: `Function` accepts any
 * function-like value, so it type-checked nothing at the call site - including
 * the `.apply(this, args)` forwarding below, which is the part most worth
 * checking. The annotations are erased at compile time, so this changes no
 * runtime behaviour.
 */
type ResolveFilenameArgs = [
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown,
];
type ResolveFilename = (...args: ResolveFilenameArgs) => string;
const moduleResolver = Module as unknown as {
  _resolveFilename: ResolveFilename;
};
const originalResolve = moduleResolver._resolveFilename;
moduleResolver._resolveFilename = function (
  this: unknown,
  ...args: ResolveFilenameArgs
): string {
  return MOCKS[args[0]] ?? originalResolve.apply(this, args);
};

declare global { var __PO_TEST_COOKIES__: Record<string, string> | undefined; }
const DB_DIR = path.resolve("test-results", "reader-authorization-db");
const DB_REL_URL = "file:./test-results/reader-authorization-db/test.db";
const IDS = { admin: "reader-admin", manager: "reader-manager", cashier: "reader-cashier" } as const;
let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function asUser(id: string | null): void { globalThis.__PO_TEST_COOKIES__ = id ? { "pos-cashier": signSessionValue(id) } : {}; }

async function main(): Promise<void> {
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });
  process.env.DATABASE_URL = DB_REL_URL;
  const migration = spawnSync("npx prisma migrate deploy", {
    cwd: process.cwd(), encoding: "utf8", shell: true,
    env: { ...process.env, DATABASE_URL: DB_REL_URL },
  });
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);
  const { prisma } = await import("@/lib/db");
  const reports = await import("@/app/(dashboard)/reports/actions");
  const purchasing = await import("@/app/(dashboard)/purchasing/actions");
  const inventory = await import("@/app/(dashboard)/inventory/actions");
  const customers = await import("@/app/(dashboard)/customers/actions");

  try {
    for (const [id, name, role] of [
      [IDS.admin, "Reader Admin", "ADMIN"],
      [IDS.manager, "Reader Manager", "MANAGER"],
      [IDS.cashier, "Reader Cashier", "CASHIER"],
    ] as const) {
      await prisma.user.create({ data: { id, name, email: `${id}@reader.test`, role, active: true, pinHash: "test-only", passwordHash: "test-only" } });
    }

    const readers: Array<[string, () => unknown | Promise<unknown>, "result" | "empty"]> = [
      ["getDailySummary", () => reports.getDailySummary("2026-09-25"), "result"],
      ["getTopSellingProducts", () => reports.getTopSellingProducts(5, { date: "2026-09-25" }), "result"],
      ["getSalesAnalytics", () => reports.getSalesAnalytics(), "result"],
      // These five purchasing readers return a safe non-error empty result on
      // denial (S-6: no thrown `Error(denied)` from a reader path), so denied
      // callers are asserted on the EMPTY value, not on a rejection.
      ["getPurchaseOrders", () => purchasing.getPurchaseOrders(), "empty"],
      ["getReceivingHistory", () => purchasing.getReceivingHistory("missing-po"), "empty"],
      ["getPurchaseOrder", () => purchasing.getPurchaseOrder("missing-po"), "empty"],
      ["getSuppliersForSelect", () => purchasing.getSuppliersForSelect(), "empty"],
      ["getProductsForSelect", () => purchasing.getProductsForSelect(), "empty"],
      ["getStockMovements", () => inventory.getStockMovements("missing-product"), "result"],
    ];

    for (const actor of [null, IDS.cashier] as const) {
      const label = actor === null ? "signed-out" : "CASHIER";
      for (const [name, invoke, kind] of readers) {
        await check(`${label} cannot read ${name}`, async () => {
          asUser(actor);
          if (kind === "result") {
            const result = await invoke() as { ok: boolean; error?: string };
            assert.equal(result.ok, false);
            assert.match(result.error ?? "", /permission|signed in/i);
            assert.equal("data" in result, false, "denied reader must not return data");
          } else {
            // Denied purchasing readers resolve to an empty collection (or
            // null for the single-record fetch) — never data, never a throw.
            const value = await invoke() as unknown[] | null;
            assert.ok(value === null || (Array.isArray(value) && value.length === 0),
              `denied reader ${name} must return an empty result, got ${JSON.stringify(value)}`);
          }
        });
      }
    }

    for (const actor of [IDS.admin, IDS.manager] as const) {
      const label = actor === IDS.admin ? "ADMIN" : "MANAGER";
      for (const [name, invoke, kind] of readers) {
        await check(`${label} can read ${name}`, async () => {
          asUser(actor);
          const result = await invoke();
          // `{ ok }`-shaped readers report success; collection readers return
          // a non-empty-allowed value (empty only means "no rows", never denial).
          if (kind === "result") assert.equal((result as { ok: boolean }).ok, true);
          else assert.ok(result === null || Array.isArray(result), `reader ${name} returned an unexpected shape`);
        });
      }
    }

    await check("customer readers remain intentionally available to CASHIER", async () => {
      asUser(IDS.cashier);
      const result = await customers.getCustomers();
      assert.equal(result.ok, true);
    });
    await check("customer readers still reject signed-out sessions", async () => {
      asUser(null);
      const result = await customers.getCustomers();
      assert.equal(result.ok, false);
    });

    console.log(`Reader authorization tests: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    rmSync(DB_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
