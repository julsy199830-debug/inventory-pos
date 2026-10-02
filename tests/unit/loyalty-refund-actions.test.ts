/**
 * Phase 1d integration tests for loyalty redemption (`createSale`) and partial
 * refunds (`refundSale`) in `src/app/actions/sales.ts`.
 *
 * Run: npx tsx tests/unit/loyalty-refund-actions.test.ts
 *
 * ISOLATION: identical to the other Server Action suites — `DATABASE_URL` points
 * at a throwaway file under `test-results/`, the real migrations are applied to
 * it, fixtures are seeded locally, and the directory is deleted at the end. The
 * repository's `dev.db` is never opened.
 *
 * WHAT IS PINNED DOWN:
 *  - redemption deducts exactly the points spent, records them on the sale, and
 *    leaves the earning rule untouched for sales that redeem nothing;
 *  - redemption is refused beyond the balance and beyond the cart's value;
 *  - a refund returns stock + a ledger movement, records an audit row, and can
 *    never be applied twice for the same units;
 *  - refunds are refused on a voided sale, and a refunded sale can no longer be
 *    voided (the two paths must not both restore stock).
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

const DB_DIR = path.resolve("test-results", "loyalty-refund-db");
const DB_REL_URL = "file:./test-results/loyalty-refund-db/loyalty-refund.db";

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
  const { createSale, refundSale, voidSale } = await import("@/app/actions/sales");

  const ADMIN = "u-lr-admin";
  const MANAGER = "u-lr-manager";
  const CASHIER = "u-lr-cashier";
  for (const [id, name, role, pin] of [
    [ADMIN, "Loyalty Admin", "ADMIN", "1234"],
    [MANAGER, "Loyalty Manager", "MANAGER", "2345"],
    [CASHIER, "Loyalty Cashier", "CASHIER", "3456"],
  ] as const) {
    await prisma.user.create({
      data: {
        id,
        name,
        email: `${name.toLowerCase().replace(/ /g, ".")}@loyalty-refund.test`,
        passwordHash: "test-only-not-used",
        pinHash: await hashPin(pin),
        role,
        active: true,
      },
    });
  }

  // Tax 0 so peso assertions stay exact; the tax interaction is covered by the
  // pure rule tests rather than here.
  await prisma.storeSetting.create({
    data: {
      storeName: "LR Test",
      taxRate: 0,
      currencySymbol: "P",
      // `updatedAt` is a plain DateTime (not @updatedAt) in this schema, so it
      // is not auto-populated on insert.
      updatedAt: new Date(),
    },
  });

  let n = 0;
  async function makeProduct(price: number, stock: number): Promise<string> {
    n += 1;
    const p = await prisma.product.create({
      data: { name: `LR Widget ${n}`, sku: `LR-${String(n).padStart(4, "0")}`, price, cost: 1, stock },
    });
    return p.id;
  }
  async function makeCustomer(points: number, creditLimit = 0, balance = 0): Promise<string> {
    n += 1;
    const c = await prisma.customer.create({
      data: { name: `LR Customer ${n}`, loyaltyPoints: points, creditLimit, currentBalance: balance },
    });
    return c.id;
  }
  const pointsOf = (id: string): Promise<number> =>
    prisma.customer.findUniqueOrThrow({ where: { id } }).then((c) => c.loyaltyPoints);
  const stockOf = (id: string): Promise<number> =>
    prisma.product.findUniqueOrThrow({ where: { id } }).then((p) => p.stock);
  const saleById = (id: string) =>
    prisma.sale.findUniqueOrThrow({ where: { id }, include: { items: true } });

  /** Buy `qty` of one product and return the created sale id. */
  async function buy(
    productId: string,
    qty: number,
    opts: { customerId?: string; redeemPoints?: number; method?: string } = {},
  ): Promise<string> {
    const res = await createSale({
      customerId: opts.customerId ?? null,
      paymentMethod: opts.method ?? "CASH",
      items: [{ productId, quantity: qty }],
      tendered: 100000,
      redeemPoints: opts.redeemPoints ?? 0,
    });
    if (!res.ok) throw new Error(`fixture sale failed: ${res.error}`);
    return res.data.id;
  }

  asUser(CASHIER);

  // == SECTION ==
  await check("1. a sale with no redemption earns exactly floor(taxable/10)", async () => {
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(0);
    const id = await buy(product, 1, { customerId: customer });
    const sale = await saleById(id);
    assert.equal(sale.earnedPoints, 10, "100 pesos -> 10 points, as before Phase 1d");
    assert.equal(sale.redeemedPoints, 0);
    assert.equal(sale.redemptionAmount, 0);
    assert.equal(await pointsOf(customer), 10);
  });

  // == SECTION ==
  await check("2. redeeming points deducts exactly what was spent and lowers the total", async () => {
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(500);
    const id = await buy(product, 1, { customerId: customer, redeemPoints: 200 });
    const sale = await saleById(id);
    assert.equal(sale.redeemedPoints, 200);
    assert.equal(sale.redemptionAmount, 2, "200 points = P2.00");
    assert.equal(sale.totalAmount, 98, "total reduced by the redemption");
    // 98 cash-paid -> 9 points, not 10 (no points earned on the point-paid part).
    assert.equal(sale.earnedPoints, 9);
    assert.equal(await pointsOf(customer), 500 - 200 + 9, "net movement recorded once");
  });

  await check("3. redemption beyond the balance is refused and changes nothing", async () => {
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(50);
    const res = await createSale({
      customerId: customer,
      paymentMethod: "CASH",
      items: [{ productId: product, quantity: 1 }],
      tendered: 1000,
      redeemPoints: 500,
    });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /does not have that many points/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await pointsOf(customer), 50, "balance untouched");
    assert.equal(await stockOf(product), 10, "no stock movement from a refused sale");
  });

  await check("4. points worth more than the cart are refused, not silently clamped", async () => {
    const product = await makeProduct(5, 10);
    const customer = await makeCustomer(10000);
    const res = await createSale({
      customerId: customer,
      paymentMethod: "CASH",
      items: [{ productId: product, quantity: 1 }],
      tendered: 1000,
      redeemPoints: 10000,
    });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /worth more than this cart/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await pointsOf(customer), 10000, "customer keeps every point");
  });

  await check("5. guest checkout cannot redeem points", async () => {
    const product = await makeProduct(100, 10);
    const res = await createSale({
      customerId: null,
      paymentMethod: "CASH",
      items: [{ productId: product, quantity: 1 }],
      tendered: 1000,
      redeemPoints: 100,
    });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /Select a customer/.test(res.error), !res.ok ? res.error : "");
  });

  await check("6. fractional, negative and non-numeric point requests are refused", async () => {
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(1000);
    for (const bad of [10.5, -50, "abc" as unknown as number]) {
      const res = await createSale({
        customerId: customer,
        paymentMethod: "CASH",
        items: [{ productId: product, quantity: 1 }],
        tendered: 1000,
        redeemPoints: bad,
      });
      assert.equal(res.ok, false, `redeemPoints=${bad} must be refused`);
    }
    assert.equal(await pointsOf(customer), 1000, "no partial effect");
  });

  await check("7. cash tendered is validated against the post-redemption total", async () => {
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(500);
    // Total drops to 98, so 98 is enough and 97 is not.
    const ok = await createSale({
      customerId: customer,
      paymentMethod: "CASH",
      items: [{ productId: product, quantity: 1 }],
      tendered: 98,
      redeemPoints: 200,
    });
    assert.ok(ok.ok, !ok.ok ? ok.error : "");
    const tooLittle = await createSale({
      customerId: customer,
      paymentMethod: "CASH",
      items: [{ productId: product, quantity: 1 }],
      tendered: 97,
      redeemPoints: 200,
    });
    assert.equal(tooLittle.ok, false, "tendered below the reduced total is refused");
    assert.ok(
      !tooLittle.ok && /cover the total due/.test(tooLittle.error),
      !tooLittle.ok ? tooLittle.error : "",
    );
  });

  // == SECTION ==
  await check("8. refunding one unit returns stock, logs a movement and records an audit row", async () => {
    asUser(MANAGER);
    const product = await makeProduct(50, 10);
    const id = await buy(product, 2);
    assert.equal(await stockOf(product), 8, "sale decremented 2");

    const sale = await saleById(id);
    const lineId = sale.items[0].id;
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "Wrong size" });
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.amount, 50, "half of the P100 sale");
    assert.equal(res.data.status, "Partially Refunded");
    assert.equal(await stockOf(product), 9, "one unit returned");

    const after = await saleById(id);
    assert.equal(after.items[0].refundedQuantity, 1);
    assert.equal(after.refundedAmount, 50);
    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product, type: "RESTOCK" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(movement, "a RESTOCK movement was written");
    assert.equal(movement?.quantityChange, 1);
    assert.match(String(movement?.reason), /Refund for Sale/);
    const audit = await prisma.saleRefund.findMany({ where: { saleId: id } });
    assert.equal(audit.length, 1, "one audit row");
    assert.equal(audit[0].amount, 50);
    assert.equal(audit[0].reason, "Wrong size");
    assert.equal(audit[0].cashierId, MANAGER, "the acting cashier is recorded");
  });

  await check("9. refunding more units than were purchased is refused", async () => {
    asUser(MANAGER);
    const product = await makeProduct(50, 10);
    const id = await buy(product, 2);
    const lineId = (await saleById(id)).items[0].id;
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 3 }], reason: "Too many" });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /more units than were purchased/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await stockOf(product), 8, "stock untouched by the refusal");
    assert.equal((await saleById(id)).items[0].refundedQuantity, 0);
  });

  await check("10. the same units cannot be refunded twice", async () => {
    asUser(MANAGER);
    const product = await makeProduct(50, 10);
    const id = await buy(product, 2);
    const lineId = (await saleById(id)).items[0].id;
    const first = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "First" });
    assert.ok(first.ok, !first.ok ? first.error : "");
    assert.equal(await stockOf(product), 9, "one unit returned");
    // The line had 2 units, so ONE more is still legitimately refundable — the
    // guard is against exceeding what was bought, not against refunding twice.
    const second = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "Second" });
    assert.ok(second.ok, "the second unit is still refundable: " + (!second.ok ? second.error : ""));
    assert.equal((await saleById(id)).items[0].refundedQuantity, 2, "the line is now exhausted");
    // A third attempt has nothing left to take and must be refused.
    const third = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "Third" });
    assert.equal(third.ok, false, "the line is fully refunded");
    assert.ok(!third.ok && /fully refunded/.test(third.error), !third.ok ? third.error : "");
    assert.equal((await saleById(id)).refundedAmount, 100, "never more than the sale total");
    assert.equal(await stockOf(product), 10, "stock back to where it started, no double return");
  });

  await check("11. a fully refunded sale reports Refunded and cannot be refunded again", async () => {
    asUser(MANAGER);
    const product = await makeProduct(30, 5);
    const id = await buy(product, 2);
    const lineId = (await saleById(id)).items[0].id;
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 2 }], reason: "All of it" });
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.status, "Refunded");
    assert.equal(res.data.amount, 60);
    assert.equal(await stockOf(product), 5, "all stock back where it started");
    const again = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "Nope" });
    assert.equal(again.ok, false);
  });

  await check("12. duplicate lines for one item collapse into a single claim", async () => {
    asUser(MANAGER);
    const product = await makeProduct(50, 10);
    const id = await buy(product, 3);
    const lineId = (await saleById(id)).items[0].id;
    // 2 + 1 against a 3-unit line is one refund of 3, not two claims of 2.
    const res = await refundSale({
      saleId: id,
      lines: [
        { saleItemId: lineId, quantity: 2 },
        { saleItemId: lineId, quantity: 1 },
      ],
      reason: "Split entry",
    });
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.amount, 150, "the whole line, once");
    assert.equal((await saleById(id)).items[0].refundedQuantity, 3);
  });

  // == SECTION ==
  await check("13. a voided sale cannot be refunded", async () => {
    asUser(MANAGER);
    const product = await makeProduct(50, 10);
    const id = await buy(product, 1);
    const lineId = (await saleById(id)).items[0].id;
    const voided = await voidSale(id, "Mistake");
    assert.ok(voided.ok, !voided.ok ? voided.error : "");
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "Nope" });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /voided/.test(res.error), !res.ok ? res.error : "");
    assert.equal(await stockOf(product), 10, "the void restored it; the refund must not touch it again");
  });

  await check("14. a refunded sale can no longer be voided (no double stock return)", async () => {
    asUser(MANAGER);
    const product = await makeProduct(50, 10);
    const id = await buy(product, 2);
    const lineId = (await saleById(id)).items[0].id;
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "One back" });
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(await stockOf(product), 9);
    const voided = await voidSale(id, "Should not work");
    assert.equal(voided.ok, false, "void is blocked once a refund exists");
    assert.ok(!voided.ok && /refunds/.test(voided.error), !voided.ok ? voided.error : "");
    assert.equal(await stockOf(product), 9, "stock not double-restored");
  });

  await check("15. CASHIER and signed-out callers cannot refund", async () => {
    const product = await makeProduct(50, 10);
    const id = await buy(product, 1);
    const lineId = (await saleById(id)).items[0].id;
    asUser(CASHIER);
    const byCashier = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "No" });
    assert.equal(byCashier.ok, false);
    assert.ok(!byCashier.ok && /permission/.test(byCashier.error), !byCashier.ok ? byCashier.error : "");
    signedOut();
    const out = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "No" });
    assert.equal(out.ok, false);
    assert.ok(!out.ok && /Sign in/.test(out.error), !out.ok ? out.error : "");
    assert.equal(await stockOf(product), 9, "no unauthorized stock change");
  });

  await check("16. a reason is mandatory and quantities must be whole positives", async () => {
    asUser(MANAGER);
    const product = await makeProduct(50, 10);
    const id = await buy(product, 2);
    const lineId = (await saleById(id)).items[0].id;
    const noReason = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "   " });
    assert.equal(noReason.ok, false);
    assert.ok(!noReason.ok && /reason is required/.test(noReason.error), !noReason.ok ? noReason.error : "");
    for (const qty of [0, -1, 1.5]) {
      const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: qty }], reason: "Bad qty" });
      assert.equal(res.ok, false, `qty=${qty} must be refused`);
    }
    const noLines = await refundSale({ saleId: id, lines: [], reason: "Nothing" });
    assert.equal(noLines.ok, false);
    assert.ok(!noLines.ok && /at least one item/.test(noLines.error), !noLines.ok ? noLines.error : "");
    assert.equal((await saleById(id)).items[0].refundedQuantity, 0, "nothing slipped through");
  });

  await check("17. an item from a different sale cannot be refunded against this one", async () => {
    asUser(MANAGER);
    const p1 = await makeProduct(50, 10);
    const p2 = await makeProduct(25, 10);
    const saleA = await buy(p1, 1);
    const saleB = await buy(p2, 1);
    const foreignLine = (await saleById(saleB)).items[0].id;
    const res = await refundSale({ saleId: saleA, lines: [{ saleItemId: foreignLine, quantity: 1 }], reason: "Wrong sale" });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && /not part of this sale/.test(res.error), !res.ok ? res.error : "");
  });

  // == SECTION ==
  await check("18. a refund claws back earned points in proportion to the value", async () => {
    asUser(CASHIER);
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(0);
    const id = await buy(product, 1, { customerId: customer });
    assert.equal(await pointsOf(customer), 10, "earned 10 on a P100 sale");
    asUser(MANAGER);
    const lineId = (await saleById(id)).items[0].id;
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "Changed mind" });
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.amount, 100);
    assert.equal(await pointsOf(customer), 0, "the full 10 points reversed");
  });

  await check("19. a partial refund reverses only the proportional share of points", async () => {
    asUser(CASHIER);
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(0);
    const id = await buy(product, 2, { customerId: customer });
    assert.equal(await pointsOf(customer), 20, "200 pesos -> 20 points");
    asUser(MANAGER);
    const lineId = (await saleById(id)).items[0].id;
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "One back" });
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(res.data.amount, 100, "half of P200");
    assert.equal(await pointsOf(customer), 10, "half the points reversed");
  });

  await check("20. a refund never blocks on a points shortfall", async () => {
    asUser(CASHIER);
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(0);
    const id = await buy(product, 1, { customerId: customer });
    // The customer spends the points elsewhere before coming back.
    await prisma.customer.update({ where: { id: customer }, data: { loyaltyPoints: 2 } });
    asUser(MANAGER);
    const lineId = (await saleById(id)).items[0].id;
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "Refund anyway" });
    assert.ok(res.ok, "a refund must not be refused over points: " + (!res.ok ? res.error : ""));
    assert.equal(await pointsOf(customer), 0, "clamped at zero, never negative");
  });

  await check("21. voiding a sale that redeemed points hands the points back", async () => {
    asUser(CASHIER);
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(500);
    const id = await buy(product, 1, { customerId: customer, redeemPoints: 200 });
    // 500 - 200 spent + 9 earned
    assert.equal(await pointsOf(customer), 309);
    asUser(MANAGER);
    const voided = await voidSale(id, "Customer cancelled");
    assert.ok(voided.ok, !voided.ok ? voided.error : "");
    // 309 - 9 earned + 200 redeemed = 500, the starting balance.
    assert.equal(await pointsOf(customer), 500, "redeemed points returned on void");
  });

  await check("22. a STORE_CREDIT refund reduces the customer's outstanding balance", async () => {
    asUser(CASHIER);
    const product = await makeProduct(100, 10);
    const customer = await makeCustomer(0, 1000, 0);
    const id = await buy(product, 1, { customerId: customer, method: "STORE_CREDIT" });
    const balanceOf = (): Promise<number> =>
      prisma.customer.findUniqueOrThrow({ where: { id: customer } }).then((c) => c.currentBalance);
    assert.equal(await balanceOf(), 100, "the sale went on the account");
    asUser(MANAGER);
    const lineId = (await saleById(id)).items[0].id;
    const res = await refundSale({ saleId: id, lines: [{ saleItemId: lineId, quantity: 1 }], reason: "Returned" });
    assert.ok(res.ok, !res.ok ? res.error : "");
    assert.equal(await balanceOf(), 0, "the debt came back off the account");
  });

  console.log(`\nloyalty + refund action tests: ${passed} passed, ${failed} failed.`);
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

