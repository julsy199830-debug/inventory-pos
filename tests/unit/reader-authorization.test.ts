/** Direct authorization tests for management reader Server Actions. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import Module from "node:module";
import path from "node:path";

const MOCKS: Record<string, string> = {
  "server-only": path.resolve("tests/setup/mocks/server-only.cjs"),
  "next/headers": path.resolve("tests/setup/mocks/next-headers.cjs"),
  "next/cache": path.resolve("tests/setup/mocks/next-cache.cjs"),
};
const originalResolve = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
(Module as unknown as { _resolveFilename: Function })._resolveFilename = function (request: string, ...rest: unknown[]) {
  return MOCKS[request] ?? originalResolve.call(this, request, ...rest);
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
function asUser(id: string | null): void { globalThis.__PO_TEST_COOKIES__ = id ? { "pos-cashier": id } : {}; }

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

    const readers: Array<[string, () => unknown | Promise<unknown>, "result" | "raw"]> = [
      ["getDailySummary", () => reports.getDailySummary("2026-09-25"), "result"],
      ["getTopSellingProducts", () => reports.getTopSellingProducts(5, { date: "2026-09-25" }), "result"],
      ["getSalesAnalytics", () => reports.getSalesAnalytics(), "result"],
      ["getPurchaseOrders", () => purchasing.getPurchaseOrders(), "raw"],
      ["getReceivingHistory", () => purchasing.getReceivingHistory("missing-po"), "raw"],
      ["getPurchaseOrder", () => purchasing.getPurchaseOrder("missing-po"), "raw"],
      ["getSuppliersForSelect", () => purchasing.getSuppliersForSelect(), "raw"],
      ["getProductsForSelect", () => purchasing.getProductsForSelect(), "raw"],
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
            await assert.rejects(async () => { await invoke(); }, /permission|signed in/i);
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
          if (kind === "result") assert.equal((result as { ok: boolean }).ok, true);
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
