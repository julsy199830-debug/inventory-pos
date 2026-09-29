/**
 * Unit tests for `src/lib/analytics.ts` - the pure calculations behind the
 * Phase 2 dashboard, reports, inventory, employee and supplier views.
 *
 * No database and no React: every fixture here is hand-built, so each test
 * pins a specific business rule rather than "whatever the database happened to
 * contain". The properties covered are the ones that would quietly produce a
 * WRONG number on screen if they broke:
 *
 *   - voided/refunded sales never count as revenue
 *   - a partially refunded sale counts NET, not gross
 *   - day bucketing is LOCAL, so a late-night sale stays on its own day
 *   - the trend series has no gaps (a quiet day is a zero, not a hole)
 *   - percent change is null with no baseline, never a fake +100%
 *   - stock alerts rank by urgency, not by raw quantity
 *   - unknown categories still appear in the breakdown, so shares sum to 100%
 *   - employee rows survive with zeroes instead of vanishing
 *   - cancelled POs are excluded from outstanding value
 *
 * Run: npx tsx tests/unit/analytics-rules.test.ts
 */
import assert from "node:assert/strict";
import {
  adjustmentSummary,
  categoryInsights,
  categoryMix,
  employeePerformance,
  formatHourLabel,
  hourlyProfile,
  inRange,
  inventoryValuation,
  isRevenueSale,
  netSaleAmount,
  parseLocalDate,
  paymentMix,
  percentChange,
  previousRange,
  rangeFor,
  rangeWindow,
  revenueTrend,
  round2,
  salesTotals,
  shareOfTotals,
  stockAlerts,
  supplierPerformance,
  topProducts,
  type EmployeeLike,
  type ProductLike,
  type SaleForTotals,
  type SaleItemLike,
} from "@/lib/analytics";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL - ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A local-time Date, so fixtures are independent of the runner's timezone. */
const at = (iso: string, hours = 0, minutes = 0): Date =>
  new Date(
    `${iso}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`,
  );

const RANGE = { from: "2026-03-01", to: "2026-03-07" };

/**
 * A fixture sale carrying FULL line items.
 *
 * `SaleForTotals` types `items` as a quantity-only projection (all the totals
 * functions need), while the breakdowns need the whole `SaleItemLike`. Widening
 * here once means one fixture type satisfies both without a cast at every call.
 */
type TestSale = SaleForTotals & { items: SaleItemLike[] };

let saleSeq = 0;
function sale(over: Partial<TestSale> = {}): TestSale {
  saleSeq += 1;
  return {
    id: `s${saleSeq}`,
    status: "Completed",
    totalAmount: 100,
    refundedAmount: 0,
    paymentMethod: "CASH",
    createdAt: at("2026-03-02", 10),
    customerId: null,
    cashierId: null,
    items: [],
    ...over,
  };
}

function line(
  productId: string,
  name: string,
  qty: number,
  price: number,
  category: string | null = "Electronics",
): SaleItemLike {
  return {
    quantity: qty,
    priceAtSale: price,
    product: {
      id: productId,
      name,
      sku: `SKU-${productId}`,
      category: category ? { name: category } : null,
    },
  };
}

function product(over: Partial<ProductLike> = {}): ProductLike {
  return {
    id: "p1",
    name: "Widget",
    sku: "SKU-1",
    stock: 100,
    price: 10,
    cost: 6,
    category: { name: "Electronics", lowStockThreshold: 10 },
    supplier: null,
    ...over,
  };
}

// -- Sale status rules --------------------------------------------------------

check("voided and refunded sales are not revenue", () => {
  assert.equal(isRevenueSale("Completed"), true);
  assert.equal(isRevenueSale("Partially Refunded"), true);
  assert.equal(isRevenueSale("Voided"), false);
  assert.equal(isRevenueSale("Refunded"), false);
});

check("a partially refunded sale counts NET of the refund", () => {
  const s = sale({
    status: "Partially Refunded",
    totalAmount: 500,
    refundedAmount: 200,
  });
  assert.equal(netSaleAmount(s), 300);
});

check("a voided sale contributes zero even though it has a total", () => {
  assert.equal(netSaleAmount(sale({ status: "Voided", totalAmount: 999 })), 0);
});

check("a malformed over-refund clamps to zero rather than going negative", () => {
  const s = sale({ status: "Partially Refunded", totalAmount: 50, refundedAmount: 80 });
  assert.equal(netSaleAmount(s), 0);
});

// -- Totals -------------------------------------------------------------------

check("totals exclude voided sales and report refunds separately", () => {
  const totals = salesTotals([
    sale({ totalAmount: 100 }),
    sale({ totalAmount: 200, refundedAmount: 50, status: "Partially Refunded" }),
    sale({ totalAmount: 999, status: "Voided" }),
  ]);
  assert.equal(totals.transactions, 2, "the voided sale must not count as a transaction");
  assert.equal(totals.gross, 300);
  assert.equal(totals.refunded, 50);
  assert.equal(totals.revenue, 250, "100 + (200 - 50)");
  assert.equal(totals.averageOrder, 125);
});

check("average order is zero, not NaN, on a day with no sales", () => {
  const totals = salesTotals([]);
  assert.equal(totals.averageOrder, 0);
  assert.equal(totals.revenue, 0);
});

check("walk-in sales do not inflate the customer count", () => {
  const totals = salesTotals([
    sale({ customerId: "c1" }),
    sale({ customerId: "c1" }),
    sale({ customerId: "c2" }),
    sale({ customerId: null }),
  ]);
  assert.equal(totals.customers, 2);
});

check("units are summed from line items", () => {
  const totals = salesTotals([
    sale({ items: [line("a", "Alpha", 2, 5), line("b", "Beta", 3, 5)] }),
    sale({ items: [line("a", "Alpha", 1, 5)] }),
  ]);
  assert.equal(totals.units, 6);
});
// -- Dates --------------------------------------------------------------------

check("a YYYY-MM-DD date parses as LOCAL midnight, not UTC", () => {
  // The whole point: `new Date("2026-03-01")` is UTC midnight, which in a
  // negative-offset zone is the previous local day.
  const d = parseLocalDate("2026-03-01");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getHours(), 0);
});

check("a malformed date yields an Invalid Date instead of throwing", () => {
  assert.ok(Number.isNaN(parseLocalDate("not-a-date").getTime()));
});

check("the range window is half-open so the last millisecond is included", () => {
  const w = rangeWindow({ from: "2026-03-01", to: "2026-03-01" });
  assert.equal(w.gte.getDate(), 1);
  assert.equal(w.lt.getDate(), 2, "lt must be the next midnight, not 23:59:59.999");
  assert.ok(at("2026-03-01", 23, 59) < w.lt);
  assert.ok(!(at("2026-03-02", 0, 0) < w.lt));
});

check("the previous range is the same width, shifted back", () => {
  const r = rangeFor("week", parseLocalDate("2026-03-07"));
  assert.deepEqual(r, { from: "2026-03-01", to: "2026-03-07" });
  const prev = previousRange(r);
  assert.deepEqual(prev, { from: "2026-02-22", to: "2026-02-28" });
  const width =
    Math.round(
      (parseLocalDate(prev.to).getTime() - parseLocalDate(prev.from).getTime()) /
        86400000,
    ) + 1;
  assert.equal(width, 7, "the comparison window matches the current one");
});

check("inRange is inclusive of both endpoints", () => {
  assert.equal(inRange(at("2026-03-01", 0, 0), RANGE), true);
  assert.equal(inRange(at("2026-03-07", 23, 59), RANGE), true);
  assert.equal(inRange(at("2026-02-28", 23, 59), RANGE), false);
});

// -- Percent change -----------------------------------------------------------

check("percent change is null with no baseline, never a fake +100%", () => {
  assert.equal(percentChange(500, 0), null);
  assert.equal(percentChange(0, 0), null);
});

check("percent change handles both directions and negative baselines", () => {
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(50, 100), -50);
  // -100 -> +50 is a +150% swing, measured against the absolute baseline.
  assert.equal(percentChange(50, -100), 150);
});

// -- Trend series -------------------------------------------------------------

check("the trend series has no gaps: a quiet day is a zero, not a hole", () => {
  const points = revenueTrend(
    [sale({ createdAt: at("2026-03-02", 10), totalAmount: 100 })],
    RANGE,
  );
  assert.equal(points.length, 7, "one point per day in the range");
  assert.deepEqual(
    points.map((p) => p.revenue),
    [0, 100, 0, 0, 0, 0, 0],
  );
  assert.equal(points[0].key, "2026-03-01");
  assert.equal(points[6].key, "2026-03-07");
});

check("a sale at 11:59 PM stays on its own local day", () => {
  const points = revenueTrend(
    [sale({ createdAt: at("2026-03-03", 23, 59), totalAmount: 75 })],
    RANGE,
  );
  const idx = points.findIndex((p) => p.key === "2026-03-03");
  assert.equal(points[idx].revenue, 75);
  assert.equal(points.filter((p) => p.revenue > 0).length, 1);
});

check("monthly granularity collapses days into months", () => {
  const points = revenueTrend(
    [
      sale({ createdAt: at("2026-03-02"), totalAmount: 10 }),
      sale({ createdAt: at("2026-03-06"), totalAmount: 15 }),
    ],
    RANGE,
    "month",
  );
  assert.equal(points.length, 1, "the whole range is inside one month");
  assert.equal(points[0].revenue, 25);
  assert.equal(points[0].transactions, 2);
});

// -- Activity by time ---------------------------------------------------------

check("hour labels are ordinary 12-hour clock times", () => {
  assert.equal(formatHourLabel(0), "12 AM");
  assert.equal(formatHourLabel(9), "9 AM");
  assert.equal(formatHourLabel(12), "12 PM");
  assert.equal(formatHourLabel(13), "1 PM");
  assert.equal(formatHourLabel(23), "11 PM");
});

check("only hours with activity get a column, so no dead 3 AM cells", () => {
  const buckets = hourlyProfile(
    [
      sale({ createdAt: at("2026-03-02", 10), totalAmount: 100 }),
      sale({ createdAt: at("2026-03-02", 15), totalAmount: 200 }),
    ],
    RANGE,
  );
  assert.deepEqual(
    buckets.map((b) => b.label),
    ["10 AM", "3 PM"],
  );
  assert.equal(buckets[0].revenue, 100);
  assert.equal(buckets[1].revenue, 200);
});

check("a window with no sales falls back to a readable opening-hours axis", () => {
  const buckets = hourlyProfile([], RANGE);
  assert.ok(buckets.length >= 8, "the empty state still needs a legible axis");
  assert.equal(buckets[0].label, "9 AM");
  assert.ok(buckets.every((b) => b.revenue === 0 && b.transactions === 0));
});

check("hour buckets are returned in clock order", () => {
  const buckets = hourlyProfile(
    [
      sale({ createdAt: at("2026-03-02", 18) }),
      sale({ createdAt: at("2026-03-02", 9) }),
      sale({ createdAt: at("2026-03-02", 13) }),
    ],
    RANGE,
  );
  assert.deepEqual(
    buckets.map((b) => b.hour),
    [9, 13, 18],
  );
});
// -- Breakdowns ---------------------------------------------------------------

check("breakdowns sort by revenue and report a share that sums to 100", () => {
  const rows = paymentMix(
    [
      sale({ paymentMethod: "CASH", totalAmount: 600 }),
      sale({ paymentMethod: "CARD", totalAmount: 300 }),
      sale({ paymentMethod: "CASH", totalAmount: 100 }),
    ],
    RANGE,
  );
  assert.equal(rows[0].label, "CASH");
  assert.equal(rows[0].revenue, 700);
  assert.equal(rows[1].revenue, 300);
  assert.equal(round2(rows.reduce((n, r) => n + r.share, 0)), 100);
});

check("a share breakdown with no revenue reports 0, not NaN", () => {
  const rows = paymentMix([sale({ totalAmount: 0 })], RANGE);
  assert.equal(rows[0].share, 0);
});

check("top products aggregate units and revenue per SKU", () => {
  const rows = topProducts(
    [
      sale({ items: [line("a", "Alpha", 2, 10), line("b", "Beta", 1, 50)] }),
      sale({ items: [line("a", "Alpha", 1, 10)] }),
    ],
    RANGE,
  );
  // Sorted by revenue, so Beta (1 x 50) leads and Alpha (3 x 10) follows.
  assert.equal(rows[0].label, "Beta");
  assert.equal(rows[0].revenue, 50);
  assert.equal(rows[1].label, "Alpha");
  assert.equal(rows[1].units, 3);
  assert.equal(rows[1].revenue, 30);
  assert.equal(rows[1].detail, "SKU-a", "the SKU rides along for the table subtitle");
});

check("uncategorized lines still appear, so shares stay honest", () => {
  const rows = categoryMix(
    [sale({ items: [line("a", "Alpha", 1, 100, null)] })],
    RANGE,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Uncategorized");
  assert.equal(rows[0].share, 100);
});

check("shareOfTotals breaks ties deterministically", () => {
  const groups = new Map([
    ["b", { label: "Bravo", revenue: 10, units: 1 }],
    ["a", { label: "Alpha", revenue: 10, units: 1 }],
  ]);
  assert.deepEqual(
    shareOfTotals(groups).map((r) => r.label),
    ["Alpha", "Bravo"],
  );
});

// -- Inventory valuation ------------------------------------------------------

check("valuation reports retail, cost and margin from the stored prices", () => {
  const v = inventoryValuation([
    product({ id: "a", stock: 10, price: 100, cost: 60 }),
    product({ id: "b", stock: 5, price: 50, cost: 20 }),
  ]);
  assert.equal(v.retailValue, 1250);
  assert.equal(v.costValue, 700);
  assert.equal(v.marginValue, 550);
  assert.equal(v.marginPercent, 44);
  assert.equal(v.units, 15);
  assert.equal(v.skus, 2);
});

check("stock states honour the category threshold, not a blanket 10", () => {
  const v = inventoryValuation([
    // Electronics threshold 20: 5 on hand is low, not fine.
    product({ id: "a", stock: 5, category: { name: "E", lowStockThreshold: 20 } }),
    // No override: falls back to 10, so 15 is healthy and 5 is low.
    product({ id: "b", stock: 5, category: { name: "F", lowStockThreshold: null } }),
    product({ id: "c", stock: 15, category: { name: "F", lowStockThreshold: null } }),
    product({ id: "d", stock: 0, category: { name: "E", lowStockThreshold: 20 } }),
  ]);
  assert.equal(v.outOfStock, 1);
  assert.equal(v.lowStock, 2);
  assert.equal(v.inStock, 1);
});

check("value at risk counts only the low lines still holding stock", () => {
  const v = inventoryValuation([
    product({ id: "a", stock: 3, price: 100, category: { name: "E", lowStockThreshold: 10 } }),
    product({ id: "b", stock: 0, price: 100, category: { name: "E", lowStockThreshold: 10 } }),
    product({ id: "c", stock: 50, price: 100, category: { name: "E", lowStockThreshold: 10 } }),
  ]);
  assert.equal(v.atRiskValue, 300, "3 x 100; the empty line is already worth nothing");
});

check("an empty catalog values to zero rather than NaN", () => {
  const v = inventoryValuation([]);
  assert.equal(v.retailValue, 0);
  assert.equal(v.marginPercent, 0);
  assert.equal(v.skus, 0);
});

// -- Stock alerts -------------------------------------------------------------

check("out-of-stock lines lead, then the emptiest shelf ratio wins", () => {
  // The ranking is stock-remaining AS A FRACTION OF ITS THRESHOLD, not raw
  // units. That is the whole point: 5 left against a cut-off of 90 is a nearly
  // bare shelf, while 1 left against a cut-off of 10 has 10% of a small
  // cushion. Sorting by raw quantity would rank these backwards.
  const alerts = stockAlerts([
    product({ id: "safe", stock: 99, name: "Healthy" }),
    product({ id: "wide", stock: 5, name: "NearlyBareWideCutoff", category: { name: "E", lowStockThreshold: 90 } }),
    product({ id: "urgent", stock: 1, name: "OneLeftOfTen", category: { name: "E", lowStockThreshold: 10 } }),
    product({ id: "gone", stock: 0, name: "SoldOut" }),
  ]);
  assert.deepEqual(
    alerts.map((a) => a.name),
    ["SoldOut", "NearlyBareWideCutoff", "OneLeftOfTen"],
    "empty first, then closest to its own threshold",
  );
});
check("a product exactly at its threshold is NOT an alert", () => {
  const alerts = stockAlerts([
    product({ stock: 10, category: { name: "E", lowStockThreshold: 10 } }),
  ]);
  assert.equal(alerts.length, 0, "the cutoff is inclusive of healthy stock");
});

// -- Category insights --------------------------------------------------------

check("category insights keep uncategorized as a visible row", () => {
  const rows = categoryInsights([
    product({ id: "a", stock: 60, category: { name: "Apparel", lowStockThreshold: 10 } }),
    product({ id: "b", stock: 40, category: null }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Apparel");
  assert.equal(rows[0].unitShare, 60);
  assert.equal(rows[1].name, "Uncategorized");
  assert.equal(rows[1].unitShare, 40);
});

check("category unit shares sum to 100", () => {
  const rows = categoryInsights([
    product({ id: "a", stock: 10, category: { name: "A", lowStockThreshold: 10 } }),
    product({ id: "b", stock: 30, category: { name: "B", lowStockThreshold: 10 } }),
  ]);
  assert.equal(round2(rows.reduce((n, r) => n + r.unitShare, 0)), 100);
});
// -- Refunds & voids ----------------------------------------------------------

check("the adjustment summary separates refunds from voids", () => {
  const s = adjustmentSummary(
    [
      { id: "r1", amount: 50, reason: "Damaged", createdAt: at("2026-03-02"), items: [{ quantity: 1 }] },
      { id: "r2", amount: 25, reason: "Damaged", createdAt: at("2026-03-03"), items: [{ quantity: 2 }] },
      { id: "r3", amount: 10, reason: "Changed mind", createdAt: at("2026-03-04") },
    ],
    [{ id: "v1", totalAmount: 200, voidReason: "Test", voidedAt: at("2026-03-02") }],
    RANGE,
    1000,
  );
  assert.equal(s.refundCount, 3);
  assert.equal(s.refundTotal, 85);
  assert.equal(s.refundUnits, 3);
  assert.equal(s.voidCount, 1);
  assert.equal(s.voidTotal, 200);
  assert.equal(s.totalGivenBack, 285);
  assert.equal(s.ratePercent, 28.5);
  assert.equal(s.topReason?.reason, "Damaged", "the most-used reason surfaces first");
  assert.equal(s.topReason?.count, 2);
});

check("the leakage rate is null, not 0%, when there were no sales", () => {
  const s = adjustmentSummary([], [], RANGE, 0);
  assert.equal(s.ratePercent, null, "0% would imply a clean day, not a closed till");
  assert.equal(s.totalGivenBack, 0);
});

check("refunds and voids outside the window are ignored", () => {
  const s = adjustmentSummary(
    [{ id: "r1", amount: 50, reason: "x", createdAt: at("2026-02-01") }],
    [{ id: "v1", totalAmount: 70, voidReason: "x", voidedAt: at("2026-04-01") }],
    RANGE,
    1000,
  );
  assert.equal(s.refundTotal, 0);
  assert.equal(s.voidTotal, 0);
});

check("a refund with no reason is labelled rather than blank", () => {
  const s = adjustmentSummary(
    [{ id: "r1", amount: 5, reason: "   ", createdAt: at("2026-03-02") }],
    [],
    RANGE,
    100,
  );
  assert.equal(s.topReason?.reason, "No reason given");
});

// -- Employee performance -----------------------------------------------------

const STAFF: EmployeeLike[] = [
  { id: "u1", name: "Ada", role: "CASHIER", active: true },
  { id: "u2", name: "Ben", role: "CASHIER", active: false },
];

check("an employee with no sales still appears, with zeroes", () => {
  const rows = employeePerformance(STAFF, [], [], [], RANGE);
  assert.equal(rows.length, 2, "a quiet shift is information, not a missing row");
  const ben = rows.find((r) => r.name === "Ben");
  assert.equal(ben?.transactions, 0);
  assert.equal(ben?.revenue, 0);
});

check("employee revenue, transaction count and average are computed per person", () => {
  const rows = employeePerformance(
    STAFF,
    [
      sale({ cashierId: "u1", totalAmount: 100 }),
      sale({ cashierId: "u1", totalAmount: 300 }),
      sale({ cashierId: "u1", status: "Voided", totalAmount: 999 }),
      sale({ cashierId: "u2", totalAmount: 50 }),
    ],
    [],
    [],
    RANGE,
  );
  const ada = rows.find((r) => r.name === "Ada");
  assert.equal(ada?.transactions, 2, "the voided sale is not a transaction");
  assert.equal(ada?.revenue, 400);
  assert.equal(ada?.averageOrder, 200);
});

check("refunds and voids are attributed to whoever processed them", () => {
  const rows = employeePerformance(
    STAFF,
    [sale({ cashierId: "u1", totalAmount: 200 })],
    [{ id: "r", amount: 30, reason: "x", createdAt: at("2026-03-02"), cashierId: "u2" }],
    [{ id: "v", totalAmount: 40, voidReason: "x", voidedAt: at("2026-03-02"), voidedBy: "u2" }],
    RANGE,
  );
  const ben = rows.find((r) => r.name === "Ben");
  assert.equal(ben?.refundCount, 1);
  assert.equal(ben?.givenBack, 30);
  assert.equal(ben?.voidCount, 1);
  const ada = rows.find((r) => r.name === "Ada");
  assert.equal(ada?.givenBack, 0);
});

check("hours worked sums only the shifts overlapping the window", () => {
  const rows = employeePerformance(STAFF, [], [], [], RANGE, [
    { employeeId: "u1", clockIn: at("2026-03-02", 8), clockOut: at("2026-03-02", 16) },
    { employeeId: "u1", clockIn: at("2026-03-04", 9), clockOut: at("2026-03-04", 13) },
    // Entirely before the window.
    { employeeId: "u1", clockIn: at("2026-01-01", 8), clockOut: at("2026-01-01", 16) },
    // Still open, so it counts as a shift but adds no hours yet.
    { employeeId: "u2", clockIn: at("2026-03-03", 9), clockOut: null },
  ]);
  const ada = rows.find((r) => r.name === "Ada");
  assert.equal(ada?.shifts, 2);
  assert.equal(ada?.hoursWorked, 12, "8h + 4h, the out-of-window shift is excluded");
  const ben = rows.find((r) => r.name === "Ben");
  assert.equal(ben?.shifts, 1);
  assert.equal(ben?.hoursWorked, 0, "an open shift is not yet hours worked");
});

check("given-back percent is measured against that person's own gross", () => {
  const rows = employeePerformance(
    STAFF,
    [sale({ cashierId: "u1", totalAmount: 1000, refundedAmount: 100, status: "Partially Refunded" })],
    [],
    [],
    RANGE,
  );
  const ada = rows.find((r) => r.name === "Ada");
  assert.equal(ada?.revenue, 900);
  assert.equal(ada?.givenBackPercent, 0, "the sale-level refund is not a processed refund");
});

// -- Supplier performance -----------------------------------------------------

const SUPPLIERS = [
  { id: "s1", name: "Metro Wholesale" },
  { id: "s2", name: "Island Supply" },
];

const ORDERS = [
  {
    id: "po1",
    supplierId: "s1",
    status: "RECEIVED",
    createdAt: at("2026-03-01"),
    items: [{ orderedQty: 10, receivedQty: 10, unitCost: 5 }],
  },
  {
    id: "po2",
    supplierId: "s1",
    status: "ORDERED",
    createdAt: at("2026-03-02"),
    items: [{ orderedQty: 20, receivedQty: 0, unitCost: 5 }],
  },
  {
    id: "po3",
    supplierId: "s2",
    status: "CANCELLED",
    createdAt: at("2026-03-02"),
    items: [{ orderedQty: 99, receivedQty: 0, unitCost: 9 }],
  },
];

check("cancelled POs are excluded from orders and outstanding value", () => {
  const rows = supplierPerformance(SUPPLIERS, ORDERS, [], new Map(), RANGE);
  const island = rows.find((r) => r.name === "Island Supply");
  assert.equal(island?.orders, 0);
  assert.equal(island?.orderedValue, 0, "a cancelled PO is not a commitment");
  assert.equal(island?.outstandingValue, 0);
});

check("outstanding value is the unreceived remainder of open POs", () => {
  const rows = supplierPerformance(SUPPLIERS, ORDERS, [], new Map(), RANGE);
  const metro = rows.find((r) => r.name === "Metro Wholesale");
  assert.equal(metro?.orders, 2);
  assert.equal(metro?.orderedValue, 150, "10x5 + 20x5");
  assert.equal(metro?.openOrders, 1, "only the ORDERED PO still owes stock");
  assert.equal(metro?.outstandingValue, 100, "20 x 5 still to arrive");
});

check("lead time measures order to FIRST receipt, in days", () => {
  const rows = supplierPerformance(
    SUPPLIERS,
    ORDERS,
    [
      { purchaseOrderId: "po1", receivedAt: at("2026-03-04"), items: [{ receivedQty: 4 }] },
      // A second, later receipt must not inflate the lead time.
      { purchaseOrderId: "po1", receivedAt: at("2026-03-09"), items: [{ receivedQty: 6 }] },
    ],
    new Map(),
    RANGE,
  );
  const metro = rows.find((r) => r.name === "Metro Wholesale");
  assert.equal(metro?.averageLeadDays, 3, "Mar 1 to Mar 4");
  assert.equal(metro?.receivedUnits, 10);
  assert.equal(metro?.receivedValue, 50, "10 units at the PO's own unit cost");
});

check("a supplier that has never delivered reports a null lead time", () => {
  const rows = supplierPerformance(SUPPLIERS, ORDERS, [], new Map(), RANGE);
  const island = rows.find((r) => r.name === "Island Supply");
  assert.equal(island?.averageLeadDays, null, "null, not 0 days");
});

check("catalog SKU counts come from the caller's product tally", () => {
  const rows = supplierPerformance(
    SUPPLIERS,
    ORDERS,
    [],
    new Map([["s1", 7]]),
    RANGE,
  );
  assert.equal(rows.find((r) => r.name === "Metro Wholesale")?.catalogSkus, 7);
});

console.log(`\nAnalytics rule tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);