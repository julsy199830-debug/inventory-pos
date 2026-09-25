/** Direct createSale payment-integrity tests. Uses a disposable migrated SQLite DB. */
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
const DB_DIR = path.resolve("test-results", "sale-payment-db");
const DB_REL_URL = "file:./test-results/sale-payment-db/test.db";
const CASHIER_ID = "sale-payment-cashier";
const CUSTOMER_ID = "sale-payment-customer";
const PRODUCT_ID = "sale-payment-product";
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function asUser(id: string): void { globalThis.__PO_TEST_COOKIES__ = { "pos-cashier": id }; }
function input(paymentMethod: string, extra: Record<string, unknown> = {}) {
  return {
    paymentMethod,
    subtotal: 100,
    items: [{ productId: PRODUCT_ID, quantity: 1 }],
    ...extra,
  } as any;
}

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
  const { createSale } = await import("@/app/actions/sales");
  try {
    await prisma.user.create({ data: { id: CASHIER_ID, name: "Payment Cashier", email: "payment-cashier@test", role: "CASHIER", active: true, pinHash: "test-only", passwordHash: "test-only" } });
    await prisma.customer.create({ data: { id: CUSTOMER_ID, name: "Payment Customer", creditLimit: 200, currentBalance: 0, loyaltyPoints: 0 } });
    await prisma.product.create({ data: { id: PRODUCT_ID, name: "Payment Product", sku: "PAYMENT-1", price: 100, cost: 40, stock: 10 } });
    await prisma.storeSetting.create({ data: { id: "payment-settings", storeName: "Payment Test", taxRate: 10, currencySymbol: "₱", updatedAt: new Date() } });
    asUser(CASHIER_ID);

    async function resetBusiness(): Promise<void> {
      await prisma.stockMovement.deleteMany();
      await prisma.saleItem.deleteMany();
      await prisma.sale.deleteMany();
      await prisma.customerPayment.deleteMany();
      await prisma.customer.update({ where: { id: CUSTOMER_ID }, data: { currentBalance: 0, loyaltyPoints: 0, creditLimit: 200 } });
      await prisma.product.update({ where: { id: PRODUCT_ID }, data: { stock: 10 } });
    }
    async function snapshot() {
      const [sales, items, movements, product, customer] = await Promise.all([
        prisma.sale.count(), prisma.saleItem.count(), prisma.stockMovement.count(),
        prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_ID }, select: { stock: true } }),
        prisma.customer.findUniqueOrThrow({ where: { id: CUSTOMER_ID }, select: { currentBalance: true, loyaltyPoints: true } }),
      ]);
      return { sales, items, movements, stock: product.stock, balance: customer.currentBalance, loyalty: customer.loyaltyPoints };
    }
    async function rejectedWithoutMutation(payload: unknown): Promise<void> {
      const before = await snapshot();
      const result = await createSale(payload as any);
      assert.equal(result.ok, false, "request must be rejected");
      assert.deepEqual(await snapshot(), before, "rejected payment must not mutate sale data");
    }
    await check("CASH with exact server-calculated total succeeds", async () => {
      await resetBusiness();
      const result = await createSale(input("CASH", { tendered: 110, change: 999 }));
      assert.equal(result.ok, true);
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.data.id } });
      assert.equal(sale.totalAmount, 110); assert.equal(sale.tendered, 110); assert.equal(sale.change, 0);
    });
    await check("CASH above total stores server-calculated change and ignores client change", async () => {
      await resetBusiness();
      const result = await createSale(input("CASH", { tendered: 250, change: -999 }));
      assert.equal(result.ok, true);
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.data.id } });
      assert.equal(sale.tendered, 250); assert.equal(sale.change, 140);
    });
    await check("CARD succeeds and persists null tendered/change despite client values", async () => {
      await resetBusiness();
      const result = await createSale(input("CARD", { tendered: 999, change: 999 }));
      assert.equal(result.ok, true);
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.data.id } });
      assert.equal(sale.paymentMethod, "CARD"); assert.equal(sale.tendered, null); assert.equal(sale.change, null);
    });
    await check("STORE_CREDIT succeeds, ignores cash fields, and applies customer rules", async () => {
      await resetBusiness();
      const result = await createSale(input("STORE_CREDIT", { customerId: CUSTOMER_ID, tendered: 999, change: 999 }));
      assert.equal(result.ok, true);
      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.data.id } });
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: CUSTOMER_ID } });
      assert.equal(sale.totalAmount, 110); assert.equal(sale.tendered, null); assert.equal(sale.change, null);
      assert.equal(customer.currentBalance, 110); assert.equal(customer.loyaltyPoints, 10);
    });
    await check("unsupported payment method is rejected", () => rejectedWithoutMutation(input("GIFT", { tendered: 1000 })));
    await check("CASH below authoritative total is rejected", () => rejectedWithoutMutation(input("CASH", { tendered: 109.99 })));
    await check("CASH missing tendered is rejected", () => rejectedWithoutMutation(input("CASH")));
    await check("CASH negative tendered is rejected", () => rejectedWithoutMutation(input("CASH", { tendered: -1 })));
    await check("CASH non-finite tendered is rejected", () => rejectedWithoutMutation(input("CASH", { tendered: Number.NaN })));
    await check("CASH Infinity tendered is rejected", () => rejectedWithoutMutation(input("CASH", { tendered: Number.POSITIVE_INFINITY })));
    await check("STORE_CREDIT over limit is rejected despite cash payload", async () => {
      await resetBusiness();
      await prisma.customer.update({ where: { id: CUSTOMER_ID }, data: { creditLimit: 100 } });
      await rejectedWithoutMutation(input("STORE_CREDIT", { customerId: CUSTOMER_ID, tendered: 1000, change: 1000 }));
    });
    await check("STORE_CREDIT without customer is rejected", () => rejectedWithoutMutation(input("STORE_CREDIT", { tendered: 1000 })));

    console.log(`Sale payment validation tests: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    rmSync(DB_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

