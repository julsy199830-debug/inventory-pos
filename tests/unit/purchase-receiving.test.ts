/**
 * Phase 1 integration tests for the purchasing Server Actions
 * (`src/app/(dashboard)/purchasing/actions.ts`).
 *
 * Run (from the project root):
 *   npx tsx tests/unit/po-actions.test.ts
 *
 * ISOLATION: the suite never touches the repository's real `dev.db`. Before
 * importing any app module it points `DATABASE_URL` at a throwaway SQLite file
 * under `test-results/po-test-db/`, applies the project's REAL migrations to
 * that file with `prisma migrate deploy` (create-only SQL), and seeds its own
 * fixtures (ADMIN/MANAGER/CASHIER users, two suppliers, two products). The
 * directory is removed again when the run finishes.
 *
 * The actions are Server Actions: they read `next/headers` (cookies) and call
 * `next/cache` (revalidatePath) — surfaces that do not exist outside a Next.js
 * request. The loader hooks in `tests/setup/po-test-hooks.mjs` (registered
 * below, before any app import) mock exactly those three specifiers:
 * `server-only`, `next/headers`, `next/cache`. The session cookie jar is a
 * plain object on `globalThis.__PO_TEST_COOKIES__`, switched per scenario via
 * `asUser()` / `signedOut()`. Everything else (Prisma, the actions) runs for
 * real against the throwaway database.
 *
 * PINs below are test-only fixture values on a throwaway database; no hash or
 * PIN is ever printed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";

declare global {
  var __PO_TEST_COOKIES__: Record<string, string> | undefined;
}

// ── CJS-level mocks for Server-Action-only surfaces ──────────────────────────
// tsx compiles TS to CJS in this repo (no "type": "module"), so ESM `register()`
// hooks never fire for `require()`. Redirect the three non-Node specifiers to
// stub files via the CJS resolver instead — before any app module is imported.
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

const DB_DIR = path.resolve("test-results", "po-test-db");
const DB_REL_URL = "file:./test-results/po-test-db/po-test.db";

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

/** Build a create/edit payload carrying N line items (product, qty, cost). */
function poForm(
  supplierId: string,
  lines: Array<[string, number, number]>,
  extra: Record<string, string | number> = {},
): FormData {
  const f = fd({ supplierId, lineCount: lines.length, ...extra });
  lines.forEach(([productId, qty, cost], i) => {
    f.append(`productId_${i + 1}`, productId);
    f.append(`orderedQty_${i + 1}`, String(qty));
    f.append(`unitCost_${i + 1}`, String(cost));
  });
  return f;
}

/** Point the mocked cookie jar at a user id. */
function asUser(userId: string): void {
  globalThis.__PO_TEST_COOKIES__ = { "pos-cashier": userId };
}
/** Empty jar = signed out (getCashier → null → roleGuardError denies). */
function signedOut(): void {
  globalThis.__PO_TEST_COOKIES__ = {};
}

/** Current month key, computed exactly like the action's counter key. */
function monthKey(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  const {
    createPurchaseOrder,
    updatePurchaseOrder,
    orderPurchaseOrder,
    cancelPurchaseOrder,
    receivePurchaseOrder,
  } = await import("@/app/(dashboard)/purchasing/actions");

  // ── Fixtures (test-only users/suppliers/products on the throwaway DB) ─────
  const ADMIN = "u-po-admin";
  const MANAGER = "u-po-manager";
  const CASHIER = "u-po-cashier";
  for (const [id, name, role, pin] of [
    [ADMIN, "Audit Admin", "ADMIN", "1234"],
    [MANAGER, "Audit Manager", "MANAGER", "2345"],
    [CASHIER, "Audit Cashier", "CASHIER", "3456"],
  ] as const) {
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${name.toLowerCase().replace(/ /g, ".")}@po-audit.test`,
        passwordHash: "test-only-not-used",
        pinHash: await hashPin(pin),
        role,
        active: true,
      },
    });
  }
  const supA = await prisma.supplier.create({ data: { name: "Audit Supplier A" } });
  const supB = await prisma.supplier.create({ data: { name: "Audit Supplier B" } });
  const prodA = await prisma.product.create({
    data: { name: "Audit Widget A", sku: "PO-AUD-A", price: 19.99, cost: 8.5, stock: 100, supplierId: supA.id },
  });
  const prodB = await prisma.product.create({
    data: { name: "Audit Widget B", sku: "PO-AUD-B", price: 5, cost: 3.25, stock: 7, supplierId: supA.id },
  });

  const ym = monthKey();
  const receiveForm = (id: string, values: Array<[string, number]>, key = randomUUID()): FormData => {
    const f = fd({ id, lineCount: values.length, requestKey: key });
    values.forEach(([itemId, qty], i) => {
      f.append(`itemId_${i + 1}`, itemId);
      f.append(`receiveQty_${i + 1}`, String(qty));
    });
    return f;
  };
  const stockMovementCount = (): Promise<number> => prisma.stockMovement.count();
  signedOut();

  /** Fixture helper: create a clean DRAFT PO as the given role, return id. */
  async function makePo(
    role: string,
    lines: Array<[string, number, number]> = [[prodA.id, 2, 4]],
  ): Promise<string> {
    asUser(role);
    const res = await createPurchaseOrder(poForm(supA.id, lines));
    if (!res.ok) throw new Error(`fixture PO create failed: ${res.error}`);
    return res.id ?? "";
  }

  // ══ 1. CREATE ══════════════════════════════════════════════════════════════
  // Pre-seed the monthly counter to 41. With ZERO PO rows, a MAX(poNumber)+1
  // scheme would mint 000001 — minting 000042 proves the DB-backed counter
  // drives the sequence.
  await prisma.poNumberCounter.create({ data: { month: ym, lastNumber: 41 } });

  await check("1. ADMIN creates a valid draft PO; number from DB-backed counter; stock/cost/movements untouched", async () => {
    asUser(ADMIN);
    const before = await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } });
    const res = await createPurchaseOrder(
      poForm(supA.id, [[prodA.id, 5, 10.5], [prodB.id, 3, 2.25]], {
        notes: "audit draft",
        expectedDate: "2026-10-15",
      }),
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: res.id ?? "" },
      include: { items: true },
    });
    assert.ok(po, "PO row persisted");
    assert.match(res.poNumber ?? "", /^PO-\d{6}-\d{6}$/, "poNumber format PO-YYYYMM-NNNNNN");
    assert.equal(res.poNumber, `PO-${ym}-000042`, "counter preseeded to 41 → 000042, NOT MAX+1 (would be 000001)");
    assert.equal(po.status, "DRAFT");
    assert.equal(po.createdById, ADMIN);
    assert.equal(po.items.length, 2);
    assert.equal(po.items[0].orderedQty, 5);
    assert.equal(po.items[0].unitCost, 10.5);
    assert.ok(po.expectedDate instanceof Date, "expectedDate parsed and stored");
    const after = await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } });
    assert.equal(after.stock, before.stock, "Product.stock untouched");
    assert.equal(after.cost, before.cost, "Product.cost untouched");
    assert.equal(await stockMovementCount(), 0, "no StockMovement rows");
  });

  await check("2. invalid supplier id is rejected", async () => {
    asUser(ADMIN);
    const res = await createPurchaseOrder(poForm("no-such-supplier", [[prodA.id, 1, 1]]));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /Supplier not found/.test(res.error), res.ok ? "" : res.error);
  });

  await check("3. invalid product id is rejected", async () => {
    asUser(ADMIN);
    const res = await createPurchaseOrder(poForm(supA.id, [["no-such-product", 1, 1]]));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /products were not found/.test(res.error), res.ok ? "" : res.error);
  });

  await check("4. zero / negative / fractional / non-numeric quantity is rejected", async () => {
    asUser(ADMIN);
    for (const qty of [0, -5, 2.5]) {
      const res = await createPurchaseOrder(poForm(supA.id, [[prodA.id, qty, 1]]));
      assert.equal(res.ok, false, `qty=${qty} must be rejected`);
      assert.ok(!res.ok && /quantity/.test(res.error), `qty=${qty}: ${!res.ok ? res.error : ""}`);
    }
    const res = await createPurchaseOrder(poForm(supA.id, [[prodA.id, "abc" as unknown as number, 1]]));
    assert.equal(res.ok, false, "non-numeric qty must be rejected");
  });

  await check("5. invalid unit cost is rejected (non-numeric, negative)", async () => {
    asUser(ADMIN);
    const nan = await createPurchaseOrder(poForm(supA.id, [[prodA.id, 1, "abc" as unknown as number]]));
    assert.equal(nan.ok, false);
    assert.ok(!nan.ok && /unit cost/.test(nan.error), !nan.ok ? nan.error : "");
    const neg = await createPurchaseOrder(poForm(supA.id, [[prodA.id, 1, -1]]));
    assert.equal(neg.ok, false);
    assert.ok(!neg.ok && /negative/.test(neg.error), !neg.ok ? neg.error : "");
  });

  await check("6. empty PO (no usable line items) is rejected", async () => {
    asUser(ADMIN);
    const empty = await createPurchaseOrder(fd({ supplierId: supA.id, lineCount: 0 }));
    assert.equal(empty.ok, false);
    assert.ok(!empty.ok && /At least one line item/.test(empty.error), !empty.ok ? empty.error : "");
    // A line with an empty product is skipped server-side → still zero items.
    const blank = await createPurchaseOrder(poForm(supA.id, [["", 0, 0]]));
    assert.equal(blank.ok, false);
  });

  await check("7. the same product on two lines is rejected", async () => {
    asUser(ADMIN);
    const res = await createPurchaseOrder(poForm(supA.id, [[prodA.id, 1, 1], [prodA.id, 2, 2]]));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /already added/.test(res.error), !res.ok ? res.error : "");
  });

  // ══ 2. STATUS TRANSITIONS (Phase 1 matrix) ════════════════════════════════
  await check("8. DRAFT → ORDERED succeeds (ADMIN)", async () => {
    const id = await makePo(ADMIN);
    const res = await orderPurchaseOrder(fd({ id }));
    assert.ok(res.ok, !res.ok ? res.error : "");
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
    assert.equal(po.status, "ORDERED");
  });

  await check("9. DRAFT → CANCELLED succeeds (ADMIN)", async () => {
    const id = await makePo(ADMIN);
    const res = await cancelPurchaseOrder(fd({ id }));
    assert.ok(res.ok, !res.ok ? res.error : "");
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
    assert.equal(po.status, "CANCELLED");
  });

  await check("10. ORDERED → CANCELLED succeeds (MANAGER)", async () => {
    const id = await makePo(MANAGER);
    const ord = await orderPurchaseOrder(fd({ id }));
    assert.ok(ord.ok, !ord.ok ? ord.error : "");
    const res = await cancelPurchaseOrder(fd({ id }));
    assert.ok(res.ok, !res.ok ? res.error : "");
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
    assert.equal(po.status, "CANCELLED");
  });

  await check("11. invalid transitions rejected: order/cancel an already-CANCELLED PO", async () => {
    const id = await makePo(ADMIN);
    await cancelPurchaseOrder(fd({ id }));
    const ord = await orderPurchaseOrder(fd({ id }));
    assert.equal(ord.ok, false);
    assert.ok(!ord.ok && /Cannot order/.test(ord.error), !ord.ok ? ord.error : "");
    const can = await cancelPurchaseOrder(fd({ id }));
    assert.equal(can.ok, false);
    assert.ok(!can.ok && /Cannot cancel/.test(can.error), !can.ok ? can.error : "");
  });

  await check("12. RECEIVED / PARTIALLY_RECEIVED POs cannot be ordered or cancelled", async () => {
    for (const status of ["RECEIVED", "PARTIALLY_RECEIVED"] as const) {
      const id = await makePo(ADMIN);
      await prisma.purchaseOrder.update({ where: { id }, data: { status } });
      const ord = await orderPurchaseOrder(fd({ id }));
      assert.equal(ord.ok, false, `order in ${status} must fail`);
      const can = await cancelPurchaseOrder(fd({ id }));
      assert.equal(can.ok, false, `cancel in ${status} must fail`);
    }
  });

  await check("13. CASHIER is rejected server-side on create/edit/order/cancel", async () => {
    asUser(CASHIER);
    const created = await createPurchaseOrder(poForm(supA.id, [[prodA.id, 1, 1]]));
    assert.equal(created.ok, false);
    assert.ok(!created.ok && /permission/.test(created.error), !created.ok ? created.error : "");
    const id = await makePo(ADMIN);
    asUser(CASHIER);
    const edited = await updatePurchaseOrder(fd({ id, notes: "cashier says no" }));
    assert.equal(edited.ok, false);
    assert.ok(!edited.ok && /permission/.test(edited.error), !edited.ok ? edited.error : "");
    const ordered = await orderPurchaseOrder(fd({ id }));
    assert.equal(ordered.ok, false);
    assert.ok(!ordered.ok && /permission/.test(ordered.error), !ordered.ok ? ordered.error : "");
    const cancelled = await cancelPurchaseOrder(fd({ id }));
    assert.equal(cancelled.ok, false);
    assert.ok(!cancelled.ok && /permission/.test(cancelled.error), !cancelled.ok ? cancelled.error : "");
  });

  await check("14. signed-out caller is rejected server-side", async () => {
    signedOut();
    const res = await createPurchaseOrder(poForm(supA.id, [[prodA.id, 1, 1]]));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /signed in/.test(res.error), !res.ok ? res.error : "");
    asUser(ADMIN);
  });

  await check("15. MANAGER can create and order (staff gate succeeds for MANAGER)", async () => {
    const id = await makePo(MANAGER, [[prodB.id, 4, 1.5]]);
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
    assert.equal(po.createdById, MANAGER);
    const ord = await orderPurchaseOrder(fd({ id }));
    assert.ok(ord.ok, !ord.ok ? ord.error : "");
  });

  await check("16. numbering increments sequentially from the counter; absent counter restarts at 000001", async () => {
    asUser(ADMIN);
    const counter = await prisma.poNumberCounter.findUnique({ where: { month: ym } });
    const base = counter?.lastNumber ?? 0;
    const a = await createPurchaseOrder(poForm(supA.id, [[prodA.id, 1, 1]]));
    assert.ok(a.ok, !a.ok ? a.error : "");
    assert.equal(a.poNumber, `PO-${ym}-${String(base + 1).padStart(6, "0")}`, "counter + 1");
    const b = await createPurchaseOrder(poForm(supA.id, [[prodA.id, 1, 1]]));
    assert.ok(b.ok, !b.ok ? b.error : "");
    assert.equal(b.poNumber, `PO-${ym}-${String(base + 2).padStart(6, "0")}`, "counter + 2");
    const after = await prisma.poNumberCounter.findUniqueOrThrow({ where: { month: ym } });
    assert.equal(after.lastNumber, base + 2, "PoNumberCounter.lastNumber advanced");
    // Absent-row path: delete the counter; the next create must restart at 1.
    await prisma.poNumberCounter.delete({ where: { month: ym } });
    const c = await createPurchaseOrder(poForm(supA.id, [[prodA.id, 1, 1]]));
    assert.ok(c.ok, !c.ok ? c.error : "");
    assert.equal(c.poNumber, `PO-${ym}-000001`, "upserted counter restarts at 000001");
  });

  await check("17. three concurrent creations yield three distinct sequential numbers", async () => {
    asUser(ADMIN);
    const counter = await prisma.poNumberCounter.findUniqueOrThrow({ where: { month: ym } });
    const base = counter.lastNumber;
    const results = await Promise.all([
      createPurchaseOrder(poForm(supA.id, [[prodB.id, 1, 1]])),
      createPurchaseOrder(poForm(supA.id, [[prodB.id, 1, 1]])),
      createPurchaseOrder(poForm(supA.id, [[prodB.id, 1, 1]])),
    ]);
    for (const r of results) assert.ok(r.ok, !r.ok ? r.error : "");
    const numbers = results.map((r) => (r.ok ? (r.poNumber ?? "") : ""));
    assert.equal(new Set(numbers).size, 3, "no duplicate poNumbers under concurrency");
    const suffixes = numbers.map((n) => Number(n.split("-")[2])).sort((x, y) => x - y);
    assert.deepEqual(suffixes, [base + 1, base + 2, base + 3]);
  });

  // ══ 3. EDIT RULES ═════════════════════════════════════════════════════════
  await check("18. DRAFT edit: supplier/items/qty/cost/notes/expectedDate all editable", async () => {
    const id = await makePo(ADMIN, [[prodA.id, 2, 4]]);
    const res = await updatePurchaseOrder(
      poForm(supB.id, [[prodB.id, 9, 1.25]], { id, notes: "draft edited", expectedDate: "2026-11-01" }),
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
    assert.equal(po.supplierId, supB.id, "supplier replaced");
    assert.equal(po.notes, "draft edited");
    assert.equal(po.items.length, 1);
    assert.equal(po.items[0].productId, prodB.id);
    assert.equal(po.items[0].orderedQty, 9);
    assert.equal(po.items[0].unitCost, 1.25);
  });

  await check("19. ORDERED edit: only notes/expectedDate change; supplier+items untouched", async () => {
    const id = await makePo(ADMIN, [[prodA.id, 3, 2]]);
    const ord = await orderPurchaseOrder(fd({ id }));
    assert.ok(ord.ok, !ord.ok ? ord.error : "");
    const before = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
    const res = await updatePurchaseOrder(
      poForm(supB.id, [[prodB.id, 99, 9]], { id, notes: "ordered edit", expectedDate: "2026-12-01" }),
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    const after = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
    assert.equal(after.notes, "ordered edit", "notes changed");
    assert.equal(after.supplierId, before.supplierId, "supplier unchanged");
    assert.equal(after.items.length, before.items.length, "item count unchanged");
    assert.equal(after.items[0].orderedQty, 3, "qty unchanged");
    assert.equal(after.items[0].unitCost, 2, "cost unchanged");
  });

  await check("20. CANCELLED edit is rejected (read-only)", async () => {
    const id = await makePo(ADMIN);
    await cancelPurchaseOrder(fd({ id }));
    const res = await updatePurchaseOrder(fd({ id, notes: "too late" }));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /Cancelled purchase orders cannot be edited/.test(res.error), !res.ok ? res.error : "");
  });

  await check("21. DRAFT edit with an invalid product is rejected", async () => {
    const id = await makePo(ADMIN);
    const res = await updatePurchaseOrder(poForm(supA.id, [["no-such-product", 1, 1]], { id }));
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /products were not found/.test(res.error), !res.ok ? res.error : "");
  });

  // ══ 4. WRITE ISOLATION ════════════════════════════════════════════════════
  await check("22. create/order/cancel write no Sale, Customer, or StockMovement rows", async () => {
    const sales = await prisma.sale.count();
    const customers = await prisma.customer.count();
    const id = await makePo(ADMIN, [[prodA.id, 1, 2]]);
    await orderPurchaseOrder(fd({ id }));
    await cancelPurchaseOrder(fd({ id }));
    assert.equal(await prisma.sale.count(), sales, "Sale count unchanged");
    assert.equal(await prisma.customer.count(), customers, "Customer count unchanged");
    assert.equal(await stockMovementCount(), 0, "StockMovement still empty");
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } });
    assert.equal(prod.stock, 100, "Product.stock still 100");
    assert.equal(prod.cost, 8.5, "Product.cost still 8.5");
  });

  // Phase 2 receiving coverage.
  const orderedPo = async (role: string, qty: number) => {
    asUser(role);
    const id = await makePo(role, [[prodA.id, qty, 2]]);
    const ordered = await orderPurchaseOrder(fd({ id }));
    assert.ok(ordered.ok, !ordered.ok ? ordered.error : "");
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
    return { id, itemId: po.items[0].id };
  };

  await check("23. ADMIN and MANAGER can receive stock with receipt and movement", async () => {
    const a = await orderedPo(ADMIN, 10);
    const before = await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } });
    const r = await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, 4]]));
    assert.ok(r.ok, !r.ok ? r.error : "");
    const after = await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } });
    assert.equal(after.stock, before.stock + 4);
    assert.equal(after.cost, before.cost);
    assert.equal(await prisma.purchaseReceipt.count({ where: { purchaseOrderId: a.id } }), 1);
    assert.equal(await prisma.purchaseReceiptItem.count({ where: { purchaseOrderItemId: a.itemId } }), 1);
    assert.equal(await prisma.stockMovement.count({ where: { productId: prodA.id, type: "RESTOCK" } }), 1);
    const b = await orderedPo(MANAGER, 3);
    assert.ok((await receivePurchaseOrder(receiveForm(b.id, [[b.itemId, 1]]))).ok);
  });

  await check("24. CASHIER and invalid/status cases are rejected", async () => {
    const a = await orderedPo(ADMIN, 3);
    asUser(CASHIER);
    assert.equal((await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, 1]]))).ok, false);
    const draft = await makePo(ADMIN);
    assert.equal((await receivePurchaseOrder(receiveForm(draft, [["missing", 1]]))).ok, false);
    const cancelled = await orderedPo(ADMIN, 2);
    await prisma.purchaseOrder.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    assert.equal((await receivePurchaseOrder(receiveForm(cancelled.id, [[cancelled.itemId, 1]]))).ok, false);
  });

  await check("25. quantities, wrong lines, over-receiving, and partial receiving are safe", async () => {
    const a = await orderedPo(ADMIN, 10);
    for (const qty of [-1, 1.5, 0, 11]) assert.equal((await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, qty]]))).ok, false, `qty ${qty}`);
    const other = await orderedPo(ADMIN, 2);
    assert.equal((await receivePurchaseOrder(receiveForm(a.id, [[other.itemId, 1]]))).ok, false);
    assert.ok((await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, 4]]))).ok);
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: a.id }, include: { items: true } });
    assert.equal(po.status, "PARTIALLY_RECEIVED");
    assert.equal(po.items[0].receivedQty, 4);
  });

  await check("26. exact 20/100 scenario: 40, 35, 25, then one is rejected", async () => {
    const a = await orderedPo(ADMIN, 100);
    const start = (await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } })).stock;
    for (const [qty, stock, received, status] of [[40, start + 40, 40, "PARTIALLY_RECEIVED"], [35, start + 75, 75, "PARTIALLY_RECEIVED"], [25, start + 100, 100, "RECEIVED"]] as const) {
      assert.ok((await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, qty]]))).ok);
      const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: a.id }, include: { items: true } });
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } })).stock, stock);
      assert.equal(po.items[0].receivedQty, received);
      assert.equal(po.status, status);
    }
    assert.equal((await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, 1]]))).ok, false);
    assert.equal(await prisma.purchaseReceipt.count({ where: { purchaseOrderId: a.id } }), 3);
  });

  await check("27. same requestKey is idempotent and forced movement failure rolls back", async () => {
    const a = await orderedPo(ADMIN, 5);
    const key = randomUUID();
    assert.ok((await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, 2]], key))).ok);
    assert.ok((await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, 2]], key))).ok);
    assert.equal(await prisma.purchaseReceipt.count({ where: { purchaseOrderId: a.id } }), 1);
    const b = await orderedPo(ADMIN, 5);
    const before = (await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } })).stock;
    await prisma.$executeRawUnsafe('CREATE TRIGGER "force_receipt_failure" BEFORE INSERT ON "StockMovement" BEGIN SELECT RAISE(ABORT, "forced"); END;');
    try { assert.equal((await receivePurchaseOrder(receiveForm(b.id, [[b.itemId, 2]]))).ok, false); } finally { await prisma.$executeRawUnsafe('DROP TRIGGER "force_receipt_failure"'); }
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: b.id }, include: { items: true } });
    assert.equal(po.status, "ORDERED");
    assert.equal(po.items[0].receivedQty, 0);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } })).stock, before);
    assert.equal(await prisma.purchaseReceipt.count({ where: { purchaseOrderId: b.id } }), 0);
  });

  await check("28. receiving does not alter Product.cost, sales, payments, or cancellation policy", async () => {
    const a = await orderedPo(ADMIN, 4);
    const before = await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } });
    assert.ok((await receivePurchaseOrder(receiveForm(a.id, [[a.itemId, 1]]))).ok);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: prodA.id } })).cost, before.cost);
    const cancel = await cancelPurchaseOrder(fd({ id: a.id }));
    assert.equal(cancel.ok, false);
  });


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

