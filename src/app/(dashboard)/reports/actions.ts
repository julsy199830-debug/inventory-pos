"use server";

import { prisma } from "@/lib/db";
import type { MutationResult } from "@/lib/types";

/**
 * Sales analytics & daily reporting (Z-Report).
 *
 * Read-only Server Actions used by the Server Component page at `/reports`.
 * Because they're only ever imported by a Server Component (never shipped to
 * the browser), the queries run entirely server-side against the Prisma client.
 *
 * COGS modeling note: `SaleItem` snapshots the *selling* price (`priceAtSale`)
 * but there is no cost-at-sale snapshot in the schema, so cost of goods sold is
 * approximated as `quantity × Product.cost` at the time the report runs — the
 * same approximation the accounting module uses for product costs. A product
 * repriced mid-day shifts this figure slightly; a truly exact COGS would need a
 * `costAtSale` column, which is a schema change beyond this task.
 */

/** Round a money value to cents (2 decimal places). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Convert a `YYYY-MM-DD` date string into the local-time day window `[start,
 * end]`. The POS runs on local wall-clock time (Asia/Manila shop hours), so the
 * day boundary is local midnight, not UTC. Returns `null` for a malformed date
 * so callers can surface a validation error instead of querying garbage.
 */
function dayRange(date: string): { gte: Date; lte: Date } | null {
  const start = new Date(`${date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(`${date}T23:59:59.999`);
  return { gte: start, lte: end };
}

/** One row of the payment-method breakdown (Cash / Card / …). */
export type PaymentBreakdownRow = {
  method: string;
  count: number;
  total: number;
};

/** Aggregated daily report for the Z-Report view. */
export type DailySummary = {
  /** The `YYYY-MM-DD` the summary covers, echoed back from the input. */
  date: string;
  /** Gross sales = sum of `Sale.totalAmount` (subtotal + tax). */
  revenue: number;
  /** Number of completed sales that day. */
  salesCount: number;
  /** Revenue ÷ sales count. 0 when there were no sales. */
  avgOrderValue: number;
  /** Cost of goods sold = Σ(qty × product.cost) across that day's items. */
  cogs: number;
  /** Revenue − COGS. */
  netProfit: number;
  /** Cash/Card/… totals, one row per distinct payment method. */
  paymentBreakdown: PaymentBreakdownRow[];
};

/**
 * Compute the daily sales summary for a `YYYY-MM-DD` date.
 *
 * Pulls every completed sale whose `createdAt` falls inside that local day,
 * sums revenue from `totalAmount`, counts the transactions, derives the
 * payment-method breakdown, and walks each sale's line items against the
 * current product `cost` to approximate COGS. Net profit is revenue minus that
 * COGS. All monetary values are rounded to cents, since SQLite floats otherwise
 * carry naive binary artifacts.
 */
export async function getDailySummary(
  date: string,
): Promise<MutationResult<DailySummary>> {
  const range = dayRange(date);
  if (!range) {
    return { ok: false, error: "Invalid date. Use YYYY-MM-DD." };
  }

  // Only fully-completed sales count toward a Z-Read; a mid-transaction or
  // voided record must never inflate the register total.
  const sales = await prisma.sale.findMany({
    where: { status: "Completed", createdAt: range },
    include: {
      items: {
        include: { product: { select: { cost: true } } },
      },
    },
  });

  const revenue = round2(
    sales.reduce((sum, sale) => sum + sale.totalAmount, 0),
  );
  const salesCount = sales.length;
  const cogs = round2(
    sales.reduce(
      (sum, sale) =>
        sum +
        sale.items.reduce(
          (itemSum, item) => itemSum + item.quantity * item.product.cost,
          0,
        ),
      0,
    ),
  );

  // Payment-method breakdown as an ordered map so row order is deterministic.
  const byMethod = new Map<string, PaymentBreakdownRow>();
  for (const sale of sales) {
    const row =
      byMethod.get(sale.paymentMethod) ??
      { method: sale.paymentMethod, count: 0, total: 0 };
    row.count += 1;
    row.total = round2(row.total + sale.totalAmount);
    byMethod.set(sale.paymentMethod, row);
  }

  return {
    ok: true,
    data: {
      date,
      revenue,
      salesCount,
      avgOrderValue: salesCount > 0 ? round2(revenue / salesCount) : 0,
      cogs,
      netProfit: round2(revenue - cogs),
      paymentBreakdown: [...byMethod.values()],
    },
  };
}

/** One row of the top-selling products ranking. */
export type TopProduct = {
  productId: string;
  name: string;
  sku: string;
  /** Units sold across the period (never fractional). */
  quantitySold: number;
  /** Gross revenue = Σ(qty × priceAtSale) across the period. */
  revenue: number;
};

const MAX_LIMIT = 20;
const MIN_LIMIT = 1;

/**
 * Rank the store's best movers by units sold (tie-broken by revenue), across
 * either all time or a single `YYYY-MM-DD` when `opts.date` is provided.
 *
 * Aggregation happens in JS rather than `groupBy` because revenue is a
 * *product* of `quantity` and `priceAtSale` — SQLite's `_sum` can only sum raw
 * columns, so a grouped multiplication isn't expressible in Prisma. The data
 * volume for a single store is small enough that materializing the line items
 * and folding them in a Map is both simpler and exact.
 *
 * `productId` is non-nullable with `onDelete: Restrict` on `SaleItem`, so every
 * sold product still exists — but the `Deleted product` fallback keeps the
 * report hang-proof if that invariant is ever relaxed.
 */
export async function getTopSellingProducts(
  limit: number = 5,
  opts?: { date?: string },
): Promise<MutationResult<TopProduct[]>> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), MIN_LIMIT), MAX_LIMIT);

  let range: { gte: Date; lte: Date } | null = null;
  if (opts?.date) {
    range = dayRange(opts.date);
    if (!range) {
      return { ok: false, error: "Invalid date. Use YYYY-MM-DD." };
    }
  }

  const items = await prisma.saleItem.findMany({
    where: {
      sale: {
        status: "Completed",
        ...(range ? { createdAt: range } : {}),
      },
    },
    select: { productId: true, quantity: true, priceAtSale: true },
  });

  // Fold quantity + revenue per product in one pass.
  const agg = new Map<string, { quantitySold: number; revenue: number }>();
  for (const item of items) {
    const row = agg.get(item.productId) ?? { quantitySold: 0, revenue: 0 };
    row.quantitySold += item.quantity;
    row.revenue += item.quantity * item.priceAtSale;
    agg.set(item.productId, row);
  }

  const ranked = [...agg.entries()]
    .map(([productId, stats]) => ({ productId, ...stats }))
    .sort(
      (a, b) =>
        b.quantitySold - a.quantitySold || b.revenue - a.revenue,
    )
    .slice(0, safeLimit);

  const products = await prisma.product.findMany({
    where: { id: { in: ranked.map((r) => r.productId) } },
    select: { id: true, name: true, sku: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  return {
    ok: true,
    data: ranked.map((row) => {
      const product = productById.get(row.productId);
      return {
        productId: row.productId,
        name: product?.name ?? "Deleted product",
        sku: product?.sku ?? "—",
        quantitySold: row.quantitySold,
        revenue: round2(row.revenue),
      };
    }),
  };
}

// ── Interactive analytics dashboard (`/reports/analytics`) ───────────────────
//
// The dashboard fetches ONE payload (`getSalesAnalytics`) and splits the work
// client-side: the bar chart's Month/Week toggle just picks between the two
// pre-computed series, and the donut / sparkline / table render the 30-day
// aggregations directly. All money values are rounded to cents (SQLite float
// artifacts) and percentages to one decimal.

/** One bucket of the stacked sales-volume bar chart. */
export type SalesVolumePoint = {
  /** Axis label — "Mar" / "Jul 27". */
  label: string;
  /** Revenue settled by cash for the bucket. */
  cash: number;
  /** Revenue settled by card or store credit for the bucket. */
  cardCredit: number;
};

/** One slice of the category donut (revenue share, last 30 days). */
export type CategorySalesSlice = {
  category: string;
  revenue: number;
  /** 0–100, one decimal. */
  percent: number;
};

/** One point of the order-count sparkline (daily, last 14 days). */
export type OrderTrendPoint = {
  label: string;
  orders: number;
};

/** One row of the top-products table (last 30 days). */
export type AnalyticsTopProduct = {
  productId: string;
  name: string;
  sku: string;
  category: string | null;
  /** No image column exists on Product today — always null until one is added. */
  imageUrl: string | null;
  unitsSold: number;
  revenue: number;
};

/** Rolling-30-day figures for the KPI tiles. */
export type SalesAnalyticsTotals = {
  revenue30d: number;
  orders30d: number;
  avgOrderValue30d: number;
  topCategory: { name: string; revenue: number; percent: number } | null;
};

/** The full analytics payload consumed by `/reports/analytics`. */
export type SalesAnalytics = {
  monthly: SalesVolumePoint[];
  weekly: SalesVolumePoint[];
  categories: CategorySalesSlice[];
  topProducts: AnalyticsTopProduct[];
  orderTrend: OrderTrendPoint[];
  totals: SalesAnalyticsTotals;
};

const DAY_MS = 86_400_000;
/** Bars shown in the "Monthly" period. */
const MONTHS_SHOWN = 6;
/** Bars shown in the "Weekly" period. */
const WEEKS_SHOWN = 8;
/** Order-trend sparkline length in days. */
const TREND_DAYS = 14;
/** Rolling window (days) for the donut, top products, and KPI tiles. */
const ANALYTICS_WINDOW_DAYS = 30;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Local-midnight of the day containing `d` — POS days run on local
 * wall-clock (Asia/Manila shop hours), same convention as `dayRange`. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The Monday of the week containing `d` (Monday-first ISO-style week). */
function startOfLocalWeek(d: Date): Date {
  const day = startOfLocalDay(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/** Whole days between two local dates (DST-proof via UTC normalization). */
function daysBetween(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / DAY_MS);
}

/** Normalize a stored `paymentMethod` literal into the two chart series:
 * "Cash" vs "Card/Credit" (CARD + STORE_CREDIT). Legacy rows used
 * inconsistent casing ("CARD" / "Cash"), so matching is case-insensitive;
 * anything unrecognized collapses to "other" and is excluded from the bars
 * so the stacked chart always shows exactly two series. */
function salesMethodBucket(method: string): "cash" | "cardCredit" | "other" {
  const m = method.trim().toUpperCase();
  if (m === "CASH") return "cash";
  if (m === "CARD" || m === "STORE_CREDIT" || m === "CREDIT") return "cardCredit";
  return "other";
}

function shortMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short" });
}

/** Month axis label: "Mar" for the current year, "Nov '25" when the 6-month
 * window crosses into the prior year so buckets stay unambiguous. */
function monthLabel(d: Date, lastYear: number): string {
  return d.getFullYear() === lastYear
    ? shortMonth(d)
    : `${shortMonth(d)} '${String(d.getFullYear()).slice(2)}`;
}

/** Build the six calendar-month buckets for the last six full months. */
function buildMonthlySeries(
  sales: { createdAt: Date; method: string; total: number }[],
): SalesVolumePoint[] {
  const now = new Date();
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1), 1);
  const buckets: SalesVolumePoint[] = [];
  for (let i = 0; i < MONTHS_SHOWN; i++) {
    const month = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1);
    buckets.push({
      label: monthLabel(month, now.getFullYear()),
      cash: 0,
      cardCredit: 0,
    });
  }
  for (const sale of sales) {
    const bucket = salesMethodBucket(sale.method);
    if (bucket === "other") continue;
    const offset =
      (sale.createdAt.getFullYear() - firstMonth.getFullYear()) * 12 +
      (sale.createdAt.getMonth() - firstMonth.getMonth());
    if (offset >= 0 && offset < MONTHS_SHOWN) {
      buckets[offset][bucket] = round2(buckets[offset][bucket] + sale.total);
    }
  }
  return buckets;
}

/** Build the eight Monday-starting weekly buckets for the last eight weeks. */
function buildWeeklySeries(
  sales: { createdAt: Date; method: string; total: number }[],
): SalesVolumePoint[] {
  const currentWeekStart = startOfLocalWeek(new Date());
  const firstWeekStart = new Date(currentWeekStart);
  firstWeekStart.setDate(firstWeekStart.getDate() - (WEEKS_SHOWN - 1) * 7);
  const buckets: SalesVolumePoint[] = [];
  for (let i = 0; i < WEEKS_SHOWN; i++) {
    const week = new Date(firstWeekStart);
    week.setDate(firstWeekStart.getDate() + i * 7);
    buckets.push({
      label: week.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      cash: 0,
      cardCredit: 0,
    });
  }
  for (const sale of sales) {
    const bucket = salesMethodBucket(sale.method);
    if (bucket === "other") continue;
    // `daysBetween` returns whole days; both dates are Mondays so the value is
    // always an exact multiple of 7 — dividing yields the week index.
    const index = daysBetween(startOfLocalWeek(sale.createdAt), firstWeekStart) / 7;
    if (index >= 0 && index < WEEKS_SHOWN) {
      buckets[index][bucket] = round2(buckets[index][bucket] + sale.total);
    }
  }
  return buckets;
}

/** Daily order counts for the last 14 days — the sparkline series. */
function buildOrderTrend(sales: { createdAt: Date }[]): OrderTrendPoint[] {
  const now = new Date();
  const firstDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (TREND_DAYS - 1),
  );
  const buckets: OrderTrendPoint[] = [];
  for (let i = 0; i < TREND_DAYS; i++) {
    const day = new Date(
      firstDay.getFullYear(),
      firstDay.getMonth(),
      firstDay.getDate() + i,
    );
    buckets.push({ label: `${day.getMonth() + 1}/${day.getDate()}`, orders: 0 });
  }
  for (const sale of sales) {
    const index = daysBetween(startOfLocalDay(sale.createdAt), firstDay);
    if (index >= 0 && index < TREND_DAYS) {
      buckets[index].orders += 1;
    }
  }
  return buckets;
}

/**
 * Assemble the full analytics payload for `/reports/analytics` in two reads:
 *
 *  1. every completed sale in the last 6 months (timestamp, method, total) —
 *     feeds the monthly/weekly bars, the 14-day order sparkline, and the
 *     30-day KPI totals;
 *  2. every line item from completed sales in the last 30 days (quantity ×
 *     `priceAtSale`, joined to product name/sku/category) — feeds the donut
 *     and the top-products table. Revenue is a *product* of two columns, so
 *     it's folded in JS exactly like `getTopSellingProducts` rather than via
 *     Prisma `_sum`.
 *
 * Product thumbnail: the schema has no image column, so `imageUrl` is typed
 * and always null — the table falls back to an initials avatar today.
 */
export async function getSalesAnalytics(): Promise<MutationResult<SalesAnalytics>> {
  const now = new Date();
  const firstMonth = new Date(
    now.getFullYear(),
    now.getMonth() - (MONTHS_SHOWN - 1),
    1,
  );
  const windowStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (ANALYTICS_WINDOW_DAYS - 1),
  );

  const [recentSales, lineItems] = await Promise.all([
    prisma.sale.findMany({
      where: { status: "Completed", createdAt: { gte: firstMonth } },
      select: { paymentMethod: true, totalAmount: true, createdAt: true },
    }),
    prisma.saleItem.findMany({
      where: { sale: { status: "Completed", createdAt: { gte: windowStart } } },
      select: {
        productId: true,
        quantity: true,
        priceAtSale: true,
        product: {
          select: { name: true, sku: true, category: { select: { name: true } } },
        },
      },
    }),
  ]);

  const sales = recentSales.map((sale) => ({
    createdAt: sale.createdAt,
    method: sale.paymentMethod,
    total: sale.totalAmount,
  }));

  // Rolling-30-day KPI totals.
  let revenue30d = 0;
  let orders30d = 0;
  for (const sale of sales) {
    if (sale.createdAt.getTime() >= windowStart.getTime()) {
      revenue30d += sale.total;
      orders30d += 1;
    }
  }

  // Category + product aggregation over the 30-day window.
  const categoryTotals = new Map<string, number>();
  const productTotals = new Map<string, { unitsSold: number; revenue: number }>();
  for (const item of lineItems) {
    const category = item.product.category?.name ?? "Uncategorized";
    categoryTotals.set(
      category,
      (categoryTotals.get(category) ?? 0) + item.quantity * item.priceAtSale,
    );
    const row = productTotals.get(item.productId) ?? { unitsSold: 0, revenue: 0 };
    row.unitsSold += item.quantity;
    row.revenue += item.quantity * item.priceAtSale;
    productTotals.set(item.productId, row);
  }

  const grandTotal = [...categoryTotals.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const categories: CategorySalesSlice[] = [...categoryTotals.entries()]
    .map(([category, revenue]) => ({
      category,
      revenue: round2(revenue),
      percent: grandTotal > 0 ? round1((revenue / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const productInfo = new Map(
    lineItems.map((item) => [
      item.productId,
      {
        name: item.product.name,
        sku: item.product.sku,
        category: item.product.category?.name ?? null,
      },
    ]),
  );

  const topProducts: AnalyticsTopProduct[] = [...productTotals.entries()]
    .map(([productId, stats]) => {
      const info = productInfo.get(productId);
      return {
        productId,
        name: info?.name ?? "Deleted product",
        sku: info?.sku ?? "—",
        category: info?.category ?? null,
        imageUrl: null,
        unitsSold: stats.unitsSold,
        revenue: round2(stats.revenue),
      };
    })
    .sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue)
    .slice(0, 5);

  return {
    ok: true,
    data: {
      monthly: buildMonthlySeries(sales),
      weekly: buildWeeklySeries(sales),
      categories,
      topProducts,
      orderTrend: buildOrderTrend(sales),
      totals: {
        revenue30d: round2(revenue30d),
        orders30d,
        avgOrderValue30d: orders30d > 0 ? round2(revenue30d / orders30d) : 0,
        topCategory: categories[0]
          ? {
              name: categories[0].category,
              revenue: categories[0].revenue,
              percent: categories[0].percent,
            }
          : null,
      },
    },
  };
}
