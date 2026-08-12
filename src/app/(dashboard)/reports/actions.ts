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