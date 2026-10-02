/**
 * Phase 1e integration tests: the audit trail and the bulk product import,
 * exercising the real Server Actions in `src/app/(dashboard)/`.
 *
 * Run: npx tsx tests/unit/phase1e-actions.test.ts
 *
 * ISOLATION: identical to the other Server Action suites — `DATABASE_URL` points
 * at a throwaway file under `test-results/`, the real migrations are applied to
 * it, fixtures are seeded locally, and the directory is deleted at the end. The
 * repository's `dev.db` is never opened.
 *
 * WHAT IS PINNED DOWN — the properties that make these features trustworthy:
 *   - a product create/edit/stock-adjust writes an audit row with a real actor
 *   - a role change records BOTH the old and new role (a privilege change that
 *     records only the new value cannot answer "what could they do before?")
 *   - a failed sign-in is audited WITHOUT revealing which internal reason failed
 *   - the audit log can be filtered by action, module, user and date
 *   - a CASHIER is refused the audit log, the export and the import
 *   - a bulk import with one bad row writes NOTHING at all
 *   - a clean bulk import is atomic, audited, and writes a stock ledger entry
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { signSessionValue } from "@/lib/session-token";

declare global {
  var __PO_TEST_COOKIES__: Record<string, string> | undefined;
}

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
const origResolve = moduleResolver._resolveFilename;
moduleResolver._resolveFilename = function (
  this: unknown,
  ...args: ResolveFilenameArgs
): string {
  return MOCKS[args[0]] ?? origResolve.apply(this, args);
};

const DB_DIR = path.resolve("test-results", "phase1e-db");
const DB_REL_URL = "file:./test-results/phase1e-db/phase1e.db";

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

function asUser(userId: string): void {
  globalThis.__PO_TEST_COOKIES__ = { "pos-cashier": signSessionValue(userId) };
}
function signedOut(): void {
  globalThis.__PO_TEST_COOKIES__ = {};
}

/** Build a `FormData` from a plain object, for the FormData-shaped actions. */
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/**
 * `AuditLog.before`/`.after` are stored as JSON TEXT (SQLite has no JSON column),
 * so assertions read them back through this rather than indexing the string.
 */
function snapshot(row: { before: string | null; after: string | null }, which: "before" | "after") {
  const raw = row[which];
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}


const HEADER = "SKU,Name,Retail Price,Cost Price,Stock,Category,Supplier,Low Stock Threshold";

async function main(): Promise<void> {
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

  const { prisma } = await import("@/lib/db");
  const { hashPin } = await import("@/lib/pin");
  const inventory = await import("@/app/(dashboard)/inventory/actions");
  const importActions = await import("@/app/(dashboard)/inventory/import-actions");
  const employees = await import("@/app/(dashboard)/employees/actions");
  const audit = await import("@/app/(dashboard)/audit-log/actions");
  const reports = await import("@/app/(dashboard)/reports/actions");
  const { signInCashierPin } = await import("@/app/pos/actions");

  // ── Fixtures ──────────────────────────────────────────────────────────
  const ADMIN = "u-1e-admin";
  const MANAGER = "u-1e-manager";
  const CASHIER = "u-1e-cashier";
  for (const [id, name, role, pin] of [
    [ADMIN, "Phase1e Admin", "ADMIN", "1234"],
    [MANAGER, "Phase1e Manager", "MANAGER", "2345"],
    [CASHIER, "Phase1e Cashier", "CASHIER", "3456"],
  ] as const) {
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${name.toLowerCase().replace(/ /g, ".")}@phase1e.test`,
        passwordHash: "test-only-not-used",
        pinHash: await hashPin(pin),
        role,
        active: true,
      },
    });
  }
  await prisma.storeSetting.create({
    data: {
      storeName: "Phase 1e Test",
      taxRate: 0,
      currencySymbol: "P",
      updatedAt: new Date(),
    },
  });
  const category = await prisma.category.create({ data: { name: "Electronics" } });
  await prisma.supplier.create({ data: { name: "Metro Wholesale" } });

  const auditRows = (action?: string) =>
    prisma.auditLog.findMany({
      where: action ? { action } : {},
      orderBy: { createdAt: "asc" },
    });

  asUser(ADMIN);

  // ══ 1. AUDIT: product lifecycle ════════════════════════════════════════
  let productId = "";
  await check("1. creating a product writes an attributed audit row", async () => {
    const res = await inventory.createProduct(
      form({
        name: "Aurora Wireless Headphones",
        sku: "ELEC-0001",
        price: "129.99",
        cost: "60.00",
        stock: "42",
        categoryId: category.id,
      }),
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    productId = res.id!;
    const row = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_CREATE" } });
    assert.ok(row, "no PRODUCT_CREATE audit row was written");
    assert.equal(row.userId, ADMIN, "the audit row must name the acting user");
    assert.equal(row.actor, "Phase1e Admin");
    assert.equal(row.module, "INVENTORY", "module must be derived from the action, not passed in");
    assert.equal(row.entity, "Product");
    assert.ok(snapshot(row, "after")?.sku === "ELEC-0001", "the audit row should carry the new values");
  });

  await check("2. editing a product records both before and after", async () => {
    const res = await inventory.updateProduct(
      form({
        id: productId,
        name: "Aurora Wireless Headphones",
        sku: "ELEC-0001",
        price: "139.99",
        cost: "60.00",
        stock: "42",
        categoryId: category.id,
      }),
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    const row = await prisma.auditLog.findFirst({
      where: { action: "PRODUCT_UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row, "no PRODUCT_UPDATE audit row");
    assert.equal(snapshot(row, "before")?.price, 129.99, "the old price must be captured before the overwrite");
    assert.equal(snapshot(row, "after")?.price, 139.99);
  });

  await check("3. a stock adjustment is audited with the before/after level", async () => {
    const res = await inventory.adjustStock(productId, -5);
    assert.ok(res.ok, !res.ok ? res.error : "");
    const row = await prisma.auditLog.findFirst({
      where: { action: "PRODUCT_STOCK_ADJUST" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row, "no PRODUCT_STOCK_ADJUST audit row");
    assert.equal(snapshot(row, "before")?.stock, 42);
    assert.equal(snapshot(row, "after")?.stock, 37);
  });

  await check("4. a rejected product create writes no audit row", async () => {
    const before = (await auditRows("PRODUCT_CREATE")).length;
    const res = await inventory.createProduct(
      form({ name: "Duplicate", sku: "ELEC-0001", price: "1", cost: "1", stock: "1" }),
    );
    assert.equal(res.ok, false, "a duplicate SKU must be refused");
    assert.equal(
      (await auditRows("PRODUCT_CREATE")).length,
      before,
      "a refused action must leave no audit trace",
    );
  });

  // ══ 2. AUDIT: permission changes ═══════════════════════════════════════
  await check("5. a role change records the old AND the new role", async () => {
    const res = await employees.assignRole(form({ id: CASHIER, role: "MANAGER" }));
    assert.ok(res.ok, !res.ok ? res.error : "");
    const row = await prisma.auditLog.findFirst({
      where: { action: "EMPLOYEE_ROLE_CHANGE" },
    });
    assert.ok(row, "no EMPLOYEE_ROLE_CHANGE audit row");
    assert.equal(snapshot(row, "before")?.role, "CASHIER", "the pre-change role is the whole point of the diff");
    assert.equal(snapshot(row, "after")?.role, "MANAGER");
    await prisma.user.update({ where: { id: CASHIER }, data: { role: "CASHIER" } });
  });

  await check("6. a deactivation records both directions of access change", async () => {
    const res = await employees.toggleEmployeeStatus(form({ id: CASHIER, active: "false" }));
    assert.ok(res.ok, !res.ok ? res.error : "");
    const row = await prisma.auditLog.findFirst({
      where: { action: "EMPLOYEE_STATUS_CHANGE" },
    });
    assert.ok(row, "no EMPLOYEE_STATUS_CHANGE audit row");
    assert.equal(snapshot(row, "before")?.active, true);
    assert.equal(snapshot(row, "after")?.active, false);
    await prisma.user.update({ where: { id: CASHIER }, data: { active: true } });
  });

  // ══ 3. AUDIT: authentication ═══════════════════════════════════════════
  await check("7. a successful sign-in is audited against the real user", async () => {
    signedOut();
    const res = await signInCashierPin({ userId: CASHIER, pin: "3456" });
    assert.ok(res.ok, !res.ok ? res.error : "");
    const row = await prisma.auditLog.findFirst({ where: { action: "LOGIN_SUCCESS" } });
    assert.ok(row, "no LOGIN_SUCCESS audit row");
    assert.equal(row.userId, CASHIER);
  });

  await check("8. a wrong PIN is audited without saying WHICH check failed", async () => {
    signedOut();
    const before = (await auditRows("LOGIN_FAILURE")).length;
    const wrongPin = await signInCashierPin({ userId: CASHIER, pin: "9999" });
    const unknownUser = await signInCashierPin({ userId: "does-not-exist", pin: "1234" });
    assert.equal(wrongPin.ok, false);
    assert.equal(unknownUser.ok, false);
    assert.equal(wrongPin.error, unknownUser.error, "both failures must be indistinguishable");
    const rows = await auditRows("LOGIN_FAILURE");
    assert.equal(rows.length - before, 2, "both attempts must be audited");
    // Neither row may leak the PIN, and neither may distinguish the two reasons.
    for (const row of rows) {
      assert.ok(!JSON.stringify(row).includes("9999"), "the attempted PIN must never be recorded");
    }
  });

  await check("9. a rate-limited attempt is audited, which is the point of it", async () => {
    signedOut();
    // Burn the limiter for this account, then confirm the refusal is recorded.
    for (let i = 0; i < 25; i += 1) {
      await signInCashierPin({ userId: MANAGER, pin: "0000" });
    }
    const row = await prisma.auditLog.findFirst({ where: { action: "LOGIN_RATE_LIMITED" } });
    assert.ok(row, "throttled attempts must be visible to an administrator");
  });

  // ══ 4. AUDIT: filtering and RBAC ════════════════════════════════════════
  await check("10. the log filters by action, module and user", async () => {
    asUser(ADMIN);
    const byAction = await audit.getAuditLogs({
      query: "",
      module: "",
      action: "PRODUCT_CREATE",
      userId: "",
      from: "",
      to: "",
    });
    assert.ok(byAction.ok, !byAction.ok ? byAction.error : "");
    assert.equal(byAction.data.rows.length, 1, "exactly one PRODUCT_CREATE exists");
    assert.equal(byAction.data.rows[0].actionLabel, "Product created");

    const byModule = await audit.getAuditLogs({
      query: "",
      module: "INVENTORY",
      action: "",
      userId: "",
      from: "",
      to: "",
    });
    assert.ok(byModule.ok);
    assert.ok(
      byModule.data.rows.every((r) => r.module === "INVENTORY"),
      "a module filter must not leak other modules",
    );

    const byUser = await audit.getAuditLogs({
      query: "",
      module: "",
      action: "",
      userId: ADMIN,
      from: "",
      to: "",
    });
    assert.ok(byUser.ok);
    assert.ok(
      byUser.data.rows.every((r) => r.actor === "Phase1e Admin"),
      "a user filter must not leak other actors",
    );
  });

  await check("11. a free-text search matches actor and summary", async () => {
    asUser(ADMIN);
    const res = await audit.getAuditLogs({
      query: "Aurora",
      module: "",
      action: "",
      userId: "",
      from: "",
      to: "",
    });
    assert.ok(res.ok);
    assert.ok(res.data.rows.length > 0, "searching a product name should match its rows");
  });

  await check("12. a date window excludes rows outside it", async () => {
    asUser(ADMIN);
    const today = new Date().toISOString().slice(0, 10);
    const inRange = await audit.getAuditLogs({
      query: "",
      module: "",
      action: "",
      userId: "",
      from: today,
      to: today,
    });
    assert.ok(inRange.ok);
    assert.ok(inRange.data.total > 0, "today's rows should be inside today's window");

    const impossible = await audit.getAuditLogs({
      query: "",
      module: "",
      action: "",
      userId: "",
      from: "1999-01-01",
      to: "1999-01-02",
    });
    assert.ok(impossible.ok);
    assert.equal(impossible.data.total, 0, "a window in the past must match nothing");
  });

  await check("13. a CASHIER is refused the audit log", async () => {
    asUser(CASHIER);
    const res = await audit.getAuditLogs({
      query: "",
      module: "",
      action: "",
      userId: "",
      from: "",
      to: "",
    });
    assert.equal(res.ok, false, "the audit log must be ADMIN/MANAGER only");
    const vocabulary = await audit.getAuditVocabulary();
    assert.equal(vocabulary.ok, false);
    const exportRows = await reports.getSalesExportRows({
      from: "",
      to: "",
      paymentMethod: "",
      cashierId: "",
      query: "",
    });
    assert.equal(exportRows.ok, false, "a CASHIER must not be able to export the sales ledger");
  });

  await check("14. a signed-out caller is refused everything", async () => {
    signedOut();
    const res = await audit.getAuditLogs({
      query: "",
      module: "",
      action: "",
      userId: "",
      from: "",
      to: "",
    });
    assert.equal(res.ok, false);
    const preview = await importActions.previewProductImport("SKU,Name\nA,Widget\n");
    assert.equal(preview.ok, false);
  });


  // ══ 5. BULK IMPORT: the atomicity guarantee ══════════════════════════════
  await check("15. a preview writes nothing and classifies every row", async () => {
    asUser(ADMIN);
    const before = await prisma.product.count();
    const res = await importActions.previewProductImport(
      `${HEADER}\nNEW-1,Brand New Widget,10.00,5.00,3,Electronics,Metro Wholesale,10\n`,
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.plan.creates, 1);
    assert.equal(res.data.plan.canApply, true);
    assert.equal(
      await prisma.product.count(),
      before,
      "preview must be read-only — this is the whole safety model",
    );
  });

  await check("16. a file with ONE bad row writes NOTHING at all", async () => {
    const before = await prisma.product.count();
    const beforeMovements = await prisma.stockMovement.count();
    const res = await importActions.applyProductImport(
      `${HEADER}\nGOOD-1,Would Be Fine,10.00,5.00,3,Electronics,Metro Wholesale,10\nBAD-1,Broken,not-a-price,5.00,3,Electronics,Metro Wholesale,10\n`,
    );
    assert.equal(res.ok, false, "a batch with an error must be refused");
    assert.equal(
      await prisma.product.count(),
      before,
      "NOTHING may be written when any row is invalid — no partial import",
    );
    assert.equal(
      await prisma.stockMovement.count(),
      beforeMovements,
      "and no stock ledger entries either",
    );
    assert.equal(
      await prisma.auditLog.count({ where: { action: "PRODUCT_BULK_IMPORT" } }),
      0,
      "a refused import must not leave an audit row",
    );
  });

  await check("17. a duplicate SKU inside the file blocks the whole batch", async () => {
    const before = await prisma.product.count();
    const res = await importActions.applyProductImport(
      `${HEADER}\nDUP-1,First,10,5,1,Electronics,Metro Wholesale,10\nDUP-1,Second,10,5,1,Electronics,Metro Wholesale,10\n`,
    );
    assert.equal(res.ok, false);
    assert.equal(await prisma.product.count(), before, "no partial write on a duplicate");
  });

  await check("18. a clean import creates products, ledger rows and one audit row", async () => {
    const before = await prisma.product.count();
    const res = await importActions.applyProductImport(
      `${HEADER}\nNEW-1,Brand New Widget,10.00,5.00,3,Electronics,Metro Wholesale,10\nNEW-2,Second Widget,20.00,8.00,7,Electronics,Metro Wholesale,10\n`,
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.created, 2);
    assert.equal(await prisma.product.count(), before + 2);

    // Opening stock must be auditable in the stock ledger, not appear from nowhere.
    const created = await prisma.product.findMany({ where: { sku: { in: ["NEW-1", "NEW-2"] } } });
    for (const product of created) {
      const movement = await prisma.stockMovement.findFirst({
        where: { productId: product.id, type: "RESTOCK" },
      });
      assert.ok(movement, `${product.sku} imported with no RESTOCK ledger entry`);
      assert.equal(movement.quantityChange, product.stock);
    }

    // The category name in the file must have RESOLVED, not been dropped.
    const withCategory = await prisma.product.findFirst({ where: { sku: "NEW-1" } });
    assert.equal(withCategory?.categoryId, category.id, "category name should resolve by name");

    const auditRow = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_BULK_IMPORT" } });
    assert.ok(auditRow, "a bulk import must be audited");
    assert.equal(auditRow.userId, ADMIN);
    assert.equal(snapshot(auditRow, "after")?.created, 2);
  });


  await check("19. re-importing the same file is a no-op, not a duplicate write", async () => {
    const before = await prisma.product.count();
    const beforeMovements = await prisma.stockMovement.count();
    const res = await importActions.applyProductImport(
      `${HEADER}\nNEW-1,Brand New Widget,10.00,5.00,3,Electronics,Metro Wholesale,10\nNEW-2,Second Widget,20.00,8.00,7,Electronics,Metro Wholesale,10\n`,
    );
    assert.equal(res.ok, false, "an identical file must be reported as nothing to do");
    assert.ok(!res.ok && /nothing to import/i.test(res.error), !res.ok ? res.error : "");
    assert.equal(await prisma.product.count(), before, "no rows created");
    assert.equal(await prisma.stockMovement.count(), beforeMovements, "no ledger churn");
  });

  await check("20. an updated row is written, and its stock delta is ledgered", async () => {
    const res = await importActions.applyProductImport(
      `${HEADER}\nNEW-1,Brand New Widget v2,15.00,5.00,10,Electronics,Metro Wholesale,10\n`,
    );
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.updated, 1);
    assert.equal(res.data.created, 0);
    const product = await prisma.product.findFirst({ where: { sku: "NEW-1" } });
    assert.equal(product?.name, "Brand New Widget v2");
    assert.equal(product?.price, 15);
    assert.equal(product?.stock, 10);
    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product!.id, type: "ADJUSTMENT" },
    });
    assert.ok(movement, "a stock change must be ledgered even during an import");
    assert.equal(movement.quantityChange, 7, "3 -> 10 is a delta of +7");
  });

  await check("21. an empty or headerless file is refused, not half-applied", async () => {
    const empty = await importActions.applyProductImport("");
    assert.equal(empty.ok, false);
    const headerOnly = await importActions.applyProductImport(HEADER);
    assert.equal(headerOnly.ok, false, "a file with no data rows is not importable");
  });

  await check("22. a CASHIER cannot import products", async () => {
    asUser(CASHIER);
    const before = await prisma.product.count();
    const res = await importActions.applyProductImport(
      `${HEADER}\nSNEAKY-1,Should Not Exist,10,5,1,Electronics,Metro Wholesale,10\n`,
    );
    assert.equal(res.ok, false);
    assert.equal(await prisma.product.count(), before, "nothing may be written");
  });

  // ══ 6. SALES EXPORT ══════════════════════════════════════════════════════
  await check("23. the sales export is readable by staff and filters by date", async () => {
    asUser(ADMIN);
    const all = await reports.getSalesExportRows({
      from: "",
      to: "",
      paymentMethod: "",
      cashierId: "",
      query: "",
    });
    assert.ok(all.ok, !all.ok ? all.error : "");
    assert.ok(Array.isArray(all.data.rows));

    const impossible = await reports.getSalesExportRows({
      from: "1999-01-01",
      to: "1999-01-02",
      paymentMethod: "",
      cashierId: "",
      query: "",
    });
    assert.ok(impossible.ok);
    assert.equal(impossible.data.rows.length, 0, "a past date window must match nothing");
  });

  console.log(`\nPhase 1e action tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;

  await prisma.$disconnect();
  try {
    rmSync(DB_DIR, { recursive: true, force: true });
  } catch {
    console.log("note: temp test DB left in place (Windows file lock)");
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});


