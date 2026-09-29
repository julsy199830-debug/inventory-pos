/**
 * Pure business calculations shared by the dashboard, reports, inventory,
 * employee and supplier views (Phase 2).
 *
 * Everything here is a plain function over already-fetched rows: no Prisma, no
 * React, no clock reads. That is deliberate. These are the numbers a manager
 * acts on, so they are unit-tested directly against hand-built fixtures rather
 * than only through the UI (see `tests/unit/analytics-rules.test.ts`).
 *
 * ## Sale status
 *
 * `Sale.status` is a plain string column (SQLite has no enum - same convention
 * as `Role` and `StockMovementType`). A sale is money only when it was not
 * thrown away:
 *
 *   - `Completed`            - counts at full value.
 *   - `Partially Refunded`   - still counts, but NET of `refundedAmount`.
 *   - `Refunded`             - fully given back; counts for nothing.
 *   - `Voided`               - never counted in the first place.
 *
 * `isRevenueSale` and `netSaleAmount` are the single place that decision is
 * made, so a new view cannot quietly disagree with the others.
 *
 * ## Dates
 *
 * All bucketing is on LOCAL wall-clock, because a store's "day" is the day its
 * till was open, not a UTC boundary. `new Date("2026-01-05")` parses as UTC
 * midnight and would shift a sale into the wrong day in any negative-offset
 * zone, so every parse here goes through `parseLocalDate`.
 */

// -- Sale status ---------------------------------------------------------------

/** Statuses a `Sale` can hold, mirroring the values the POS actually writes. */
export const SALE_STATUS = {
  COMPLETED: "Completed",
  VOIDED: "Voided",
  PARTIALLY_REFUNDED: "Partially Refunded",
  REFUNDED: "Refunded",
} as const;

export type SaleStatus = (typeof SALE_STATUS)[keyof typeof SALE_STATUS];

/**
 * Does this sale represent realized revenue?
 *
 * `Completed` and `Partially Refunded` do; `Voided` and `Refunded` do not.
 */
export function isRevenueSale(status: string): boolean {
  return status === SALE_STATUS.COMPLETED || status === SALE_STATUS.PARTIALLY_REFUNDED;
}

/** The Prisma `where` fragment matching `isRevenueSale`. */
export const REVENUE_SALE_FILTER = {
  status: { in: [SALE_STATUS.COMPLETED, SALE_STATUS.PARTIALLY_REFUNDED] },
} as const;

/** The minimum a `Sale` row needs for the aggregations below. */
export type SaleLike = {
  id: string;
  status: string;
  totalAmount: number;
  /** Realized refunds already deducted from the stock ledger. */
  refundedAmount: number;
  paymentMethod: string;
  createdAt: Date;
};

/** The minimum a `SaleItem` needs. */
export type SaleItemLike = {
  quantity: number;
  priceAtSale: number;
  product: {
    id: string;
    name: string;
    sku: string;
    category: { name: string } | null;
  } | null;
};

/**
 * What a sale is actually worth today: gross minus what has been refunded.
 *
 * A fully refunded sale nets to 0 (and is excluded by `isRevenueSale`); a
 * partially refunded one still contributes its remainder. Never negative - a
 * malformed over-refund clamps to 0 rather than showing a figure the store
 * cannot have lost twice.
 */
export function netSaleAmount(sale: SaleLike): number {
  if (!isRevenueSale(sale.status)) return 0;
  return round2(Math.max(0, sale.totalAmount - (sale.refundedAmount ?? 0)));
}
// -- Money & dates -------------------------------------------------------------

/** Round to cents, so float noise never surfaces as a phantom change. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parse `YYYY-MM-DD` as LOCAL midnight.
 *
 * `new Date("2026-01-05")` is UTC midnight, which in any negative-offset zone
 * is the previous local day - a Z-Report would then silently omit or
 * double-count the day's first and last sales.
 */
export function parseLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/** `YYYY-MM-DD` for a Date, on local wall-clock. Inverse of `parseLocalDate`. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local midnight at the start of the day containing `d`. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Inclusive-exclusive window covering the whole of the local day `d`.
 *
 * Returns `[startOfDay, startOfNextDay)` rather than a 23:59:59.999 upper
 * bound so a sale landing in the final millisecond of the day is included, and
 * so this composes with Prisma's `gte`/`lt` on a `DateTime` column.
 */
export function dayWindow(d: Date): { gte: Date; lt: Date } {
  const gte = startOfDay(d);
  const lt = new Date(gte);
  lt.setDate(lt.getDate() + 1);
  return { gte, lt };
}

/** Add whole days to a Date, returning a new Date (never mutates). */
export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

// -- Range presets -------------------------------------------------------------

/**
 * Preset windows the dashboard and reports share.
 *
 * `days` is INCLUSIVE of today, so `week` is the last 7 days including the
 * current one - the range a shopkeeper means by "this week" when they are
 * looking at it mid-afternoon. The comparison in `previousRange` uses the same
 * width shifted back, so a trend arrow compares like with like.
 */
export type RangeKey = "today" | "week" | "month" | "quarter" | "year";

export const RANGE_DAYS: Record<RangeKey, number> = {
  today: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

/** Ordered for the range picker; `today` first because it is the daily driver. */
export const RANGE_ORDER: RangeKey[] = ["today", "week", "month", "quarter", "year"];

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  quarter: "Last 90 days",
  year: "Last 12 months",
};

/** Short labels for the compact segmented control. */
export const RANGE_SHORT: Record<RangeKey, string> = {
  today: "Today",
  week: "7D",
  month: "30D",
  quarter: "90D",
  year: "1Y",
};

/**
 * Coerce an arbitrary `?range=` token to a known preset.
 *
 * Anything unrecognized - a stale bookmark, a hand-edited URL - falls back to
 * `month` rather than throwing, so a bad query string can never 500 a page.
 */
export function resolveRange(value: string | string[] | undefined): RangeKey {
  const token = Array.isArray(value) ? value[0] : value;
  return RANGE_ORDER.includes(token as RangeKey) ? (token as RangeKey) : "month";
}

/** `{ from, to }` as `YYYY-MM-DD`, both inclusive, for the chosen preset. */
export function rangeFor(
  key: RangeKey,
  today: Date = new Date(),
): { from: string; to: string } {
  const days = RANGE_DAYS[key];
  const end = startOfDay(today);
  return { from: toISODate(addDays(end, -(days - 1))), to: toISODate(end) };
}

/**
 * The equally-wide window immediately BEFORE the given one.
 *
 * A "vs previous 7 days" arrow is only meaningful against another 7 days, so
 * this is a fixed shift back by the window width, not "last month" for a
 * 7-day window.
 */
export function previousRange(range: { from: string; to: string }): {
  from: string;
  to: string;
} {
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  const widthDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(widthDays - 1));
  return { from: toISODate(prevFrom), to: toISODate(prevTo) };
}

/** Half-open Prisma window for an inclusive `from`/`to` `YYYY-MM-DD` pair. */
export function rangeWindow(range: {
  from: string;
  to: string;
}): { gte: Date; lt: Date } {
  const start = parseLocalDate(range.from);
  const endExclusive = addDays(parseLocalDate(range.to), 1);
  return { gte: start, lt: endExclusive };
}

/** True when `d` falls inside the inclusive `from`/`to` window. */
export function inRange(d: Date, range: { from: string; to: string }): boolean {
  const key = toISODate(d);
  return key >= range.from && key <= range.to;
}
// -- Totals & trends -----------------------------------------------------------

/** Headline figures for a set of sales. */
export type SalesTotals = {
  /** Sum of net amounts (gross minus refunds) over revenue-bearing sales. */
  revenue: number;
  /** Count of revenue-bearing sales. */
  transactions: number;
  /** Sum of gross `totalAmount` before refunds, for a refunds impact figure. */
  gross: number;
  /** Sum of `refundedAmount` on those sales. */
  refunded: number;
  /** `revenue / transactions`, or 0 when there were no sales. */
  averageOrder: number;
  /** Number of distinct customers who bought (walk-ins are not customers). */
  customers: number;
  /** Units sold across all line items. */
  units: number;
};

/** The fields `salesTotals` needs from a sale, plus optional links. */
export type SaleForTotals = SaleLike & {
  customerId?: string | null;
  cashierId?: string | null;
  items?: Pick<SaleItemLike, "quantity">[];
};

/**
 * Sum a set of sales into the figures a manager reads first.
 *
 * Refunds are reported separately from revenue rather than netted silently, so
 * a card can show "P4,200 (-P300 refunded)" and explain a dip instead of
 * hiding it.
 */
export function salesTotals(
  sales: SaleForTotals[],
  opts: { start?: Date; end?: Date } = {},
): SalesTotals {
  let revenue = 0;
  let gross = 0;
  let refunded = 0;
  let transactions = 0;
  let units = 0;
  const customers = new Set<string>();

  for (const sale of sales) {
    if (opts.start && sale.createdAt < opts.start) continue;
    if (opts.end && sale.createdAt >= opts.end) continue;
    if (!isRevenueSale(sale.status)) continue;
    transactions += 1;
    gross += sale.totalAmount;
    refunded += sale.refundedAmount ?? 0;
    revenue += netSaleAmount(sale);
    if (sale.customerId) customers.add(sale.customerId);
    for (const item of sale.items ?? []) units += item.quantity;
  }

  return {
    revenue: round2(revenue),
    gross: round2(gross),
    refunded: round2(refunded),
    transactions,
    customers: customers.size,
    units,
    averageOrder: transactions === 0 ? 0 : round2(revenue / transactions),
  };
}

/**
 * Signed percentage change from `previous` to `current`.
 *
 * Returns `null` when there is no baseline, so a UI can show an em-dash instead
 * of a fake "+100%" for a first-ever sale day. Capped at +/-999.9 so a
 * 12 -> 0.01 swing does not render as five digits of noise.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(pct)) return null;
  return round2(Math.max(-999.9, Math.min(999.9, pct)));
}

// -- Time series ---------------------------------------------------------------

/** One point on a revenue line. */
export type TrendPoint = {
  /** `YYYY-MM-DD` for daily, `YYYY-MM` for monthly. Stable chart key. */
  key: string;
  /** Short axis label, e.g. "Mon 5". */
  label: string;
  revenue: number;
  transactions: number;
};

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Bucket sales into a contiguous daily or monthly revenue series.
 *
 * Days with no sales are EMITTED as zero rather than skipped: a trend line that
 * silently drops quiet days lies about the shape of the week, and a bar chart
 * with a missing column reads as missing data instead of a closed till.
 *
 * `granularity: "month"` is what the 1Y view uses - 365 daily columns are
 * unreadable and blow the chart's render budget.
 */
export function revenueTrend(
  sales: SaleForTotals[],
  range: { from: string; to: string },
  granularity: "day" | "month" = "day",
): TrendPoint[] {
  const totals = new Map<string, { revenue: number; transactions: number }>();

  for (const sale of sales) {
    if (!isRevenueSale(sale.status)) continue;
    if (!inRange(sale.createdAt, range)) continue;
    const key =
      granularity === "month"
        ? `${sale.createdAt.getFullYear()}-${String(sale.createdAt.getMonth() + 1).padStart(2, "0")}`
        : toISODate(sale.createdAt);
    const slot = totals.get(key) ?? { revenue: 0, transactions: 0 };
    slot.revenue += netSaleAmount(sale);
    slot.transactions += 1;
    totals.set(key, slot);
  }

  const points: TrendPoint[] = [];
  const cursor = parseLocalDate(range.from);
  const end = parseLocalDate(range.to);

  if (granularity === "month") {
    const walker = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    while (walker <= end) {
      const key = `${walker.getFullYear()}-${String(walker.getMonth() + 1).padStart(2, "0")}`;
      const slot = totals.get(key);
      points.push({
        key,
        label: SHORT_MONTHS[walker.getMonth()],
        revenue: round2(slot?.revenue ?? 0),
        transactions: slot?.transactions ?? 0,
      });
      walker.setMonth(walker.getMonth() + 1);
    }
    return points;
  }

  while (cursor <= end) {
    const key = toISODate(cursor);
    const slot = totals.get(key);
    points.push({
      key,
      label: `${SHORT_WEEKDAYS[cursor.getDay()]} ${cursor.getDate()}`,
      revenue: round2(slot?.revenue ?? 0),
      transactions: slot?.transactions ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}
// -- Activity by time ----------------------------------------------------------

/** One hour's worth of trading, for the dashboard's "Activity by time" card. */
export type HourBucket = {
  /** 0-23. */
  hour: number;
  label: string;
  revenue: number;
  transactions: number;
};

/** Hours a typical retail store is open; the fallback when there is no history. */
const DEFAULT_OPENING_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** "9 AM" / "12 PM" / "5 PM" - a single line, readable at normal axis size. */
export function formatHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const meridiem = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${meridiem}`;
}

/**
 * Per-hour revenue and transaction counts across the range, in hour order.
 *
 * This replaces the old fixed 3-hour grid, which spent four of its eight
 * columns on 12 AM - 9 AM - hours a retail till is closed - and so spent most
 * of the chart's width on guaranteed-empty cells while its labels shrank to
 * 8px to fit. Two changes:
 *
 *   1. **Only hours with activity are returned** (falling back to a standard
 *      9 AM - 8 PM retail window when nothing has sold). A store open 9 AM -
 *      9 PM shows nine readable columns, not eight squashed ones.
 *   2. **Labels are ordinary 12-hour clock times** ("9 AM", "12 PM", "5 PM"),
 *      one line each, so they never need the stacked hour/meridiem treatment
 *      that forced the tiny type.
 */
export function hourlyProfile(
  sales: SaleLike[],
  range: { from: string; to: string },
): HourBucket[] {
  const buckets = new Map<number, { revenue: number; transactions: number }>();
  for (const sale of sales) {
    if (!isRevenueSale(sale.status)) continue;
    if (!inRange(sale.createdAt, range)) continue;
    const h = sale.createdAt.getHours();
    const slot = buckets.get(h) ?? { revenue: 0, transactions: 0 };
    slot.revenue += netSaleAmount(sale);
    slot.transactions += 1;
    buckets.set(h, slot);
  }

  const hours =
    buckets.size > 0
      ? [...buckets.keys()].sort((a, b) => a - b)
      : DEFAULT_OPENING_HOURS;
  return hours.map((hour) => {
    const slot = buckets.get(hour);
    return {
      hour,
      label: formatHourLabel(hour),
      revenue: round2(slot?.revenue ?? 0),
      transactions: slot?.transactions ?? 0,
    };
  });
}

// -- Breakdowns ----------------------------------------------------------------

/** One row of a revenue-share breakdown. */
export type BreakdownRow = {
  /** Display label, e.g. "Aurora Wireless Headphones" or "Electronics". */
  label: string;
  /** Secondary identifier (SKU) shown under the label where relevant. */
  detail?: string;
  revenue: number;
  units: number;
  /** 0-100, one decimal. Zero when the whole group is zero. */
  share: number;
};

/**
 * Generic share-of-total builder.
 *
 * Every breakdown on the dashboard (payment method, category, cashier) reduces
 * to "label -> revenue/units, sorted by revenue, with a percentage", so they
 * share one implementation and therefore sort and round identically.
 */
export function shareOfTotals(
  groups: Map<string, { label: string; detail?: string; revenue: number; units: number }>,
  opts: { limit?: number } = {},
): BreakdownRow[] {
  const total = [...groups.values()].reduce((sum, g) => sum + g.revenue, 0);
  const rows = [...groups.values()].map((g) => ({
    label: g.label,
    detail: g.detail,
    revenue: round2(g.revenue),
    units: g.units,
    share: total === 0 ? 0 : round2((g.revenue / total) * 100),
  }));
  // Revenue first, then units, then label - a stable total order, so equal
  // revenue never reshuffles between renders.
  rows.sort(
    (a, b) =>
      b.revenue - a.revenue || b.units - a.units || a.label.localeCompare(b.label),
  );
  return opts.limit == null ? rows : rows.slice(0, opts.limit);
}

/** Aggregate sale lines by product, for the top-sellers table. */
export function topProducts(
  sales: (SaleForTotals & { items: SaleItemLike[] })[],
  range: { from: string; to: string },
  limit = 5,
): BreakdownRow[] {
  const groups = new Map<
    string,
    { label: string; detail?: string; revenue: number; units: number }
  >();
  for (const sale of sales) {
    if (!isRevenueSale(sale.status)) continue;
    if (!inRange(sale.createdAt, range)) continue;
    for (const item of sale.items) {
      const product = item.product;
      if (!product) continue;
      const cur = groups.get(product.id) ?? {
        label: product.name,
        detail: product.sku,
        revenue: 0,
        units: 0,
      };
      cur.revenue += item.quantity * item.priceAtSale;
      cur.units += item.quantity;
      groups.set(product.id, cur);
    }
  }
  return shareOfTotals(groups, { limit });
}

/** Revenue share by payment method. */
export function paymentMix(
  sales: SaleForTotals[],
  range: { from: string; to: string },
): BreakdownRow[] {
  const groups = new Map<string, { label: string; revenue: number; units: number }>();
  for (const sale of sales) {
    if (!isRevenueSale(sale.status)) continue;
    if (!inRange(sale.createdAt, range)) continue;
    const cur = groups.get(sale.paymentMethod) ?? {
      label: sale.paymentMethod,
      revenue: 0,
      units: 0,
    };
    cur.revenue += netSaleAmount(sale);
    cur.units += 1;
    groups.set(sale.paymentMethod, cur);
  }
  return shareOfTotals(groups);
}

/**
 * Revenue share by product category.
 *
 * Lines with no category (legal - `Product.categoryId` is `SetNull` on delete)
 * are collected under "Uncategorized" rather than dropped, so category shares
 * always sum to 100% of revenue and a store tidying its catalog can see the
 * size of the unfiled pile.
 */
export function categoryMix(
  sales: (SaleForTotals & { items: SaleItemLike[] })[],
  range: { from: string; to: string },
): BreakdownRow[] {
  const groups = new Map<string, { label: string; revenue: number; units: number }>();
  for (const sale of sales) {
    if (!isRevenueSale(sale.status)) continue;
    if (!inRange(sale.createdAt, range)) continue;
    for (const item of sale.items) {
      const name = item.product?.category?.name ?? "Uncategorized";
      const cur = groups.get(name) ?? { label: name, revenue: 0, units: 0 };
      cur.revenue += item.quantity * item.priceAtSale;
      cur.units += item.quantity;
      groups.set(name, cur);
    }
  }
  return shareOfTotals(groups);
}
// -- Inventory valuation -------------------------------------------------------

/** The minimum a `Product` needs for stock analysis. */
export type ProductLike = {
  id: string;
  name: string;
  sku: string;
  stock: number;
  price: number;
  cost: number;
  category: { name: string; lowStockThreshold: number | null } | null;
  supplier?: { id: string; name: string } | null;
};

/** Local copy of the threshold rule so this module needs no cross-import. */
function thresholdFor(product: ProductLike): number {
  const t = product.category?.lowStockThreshold;
  return t == null ? 10 : t;
}

/** Stock rollup for a catalog. */
export type InventoryValuation = {
  skus: number;
  units: number;
  /** `stock * price` - what the shelf would sell for. */
  retailValue: number;
  /** `stock * cost` - what the stock is on hand for. */
  costValue: number;
  /** `retailValue - costValue`. */
  marginValue: number;
  /** Margin as a percentage of retail value, or 0 when there is no stock. */
  marginPercent: number;
  outOfStock: number;
  lowStock: number;
  inStock: number;
  /** Retail value sitting in low-or-out lines - the money at risk. */
  atRiskValue: number;
};

/**
 * Value the catalog at cost and at retail, and count the stock states.
 *
 * Valuation is `stock * unit price` at the two figures already on the product.
 * That is a book value, not an accounting one: it deliberately does NOT attempt
 * FIFO/average-cost inventory accounting, which would need per-movement cost
 * tracking this schema does not store. It answers the question a shopkeeper
 * actually asks - "what is this shelf worth" - to the peso.
 *
 * `atRiskValue` is the practical number: retail value of everything at or
 * below its low-stock threshold, i.e. revenue that cannot currently be
 * collected without a restock.
 */
export function inventoryValuation(products: ProductLike[]): InventoryValuation {
  let units = 0;
  let retailValue = 0;
  let costValue = 0;
  let outOfStock = 0;
  let lowStock = 0;
  let inStock = 0;
  let atRiskValue = 0;

  for (const p of products) {
    const stock = p.stock ?? 0;
    units += stock;
    retailValue += stock * p.price;
    costValue += stock * p.cost;

    if (stock <= 0) outOfStock += 1;
    else if (stock < thresholdFor(p)) {
      lowStock += 1;
      atRiskValue += stock * p.price;
    } else {
      inStock += 1;
    }
  }

  retailValue = round2(retailValue);
  costValue = round2(costValue);
  return {
    skus: products.length,
    units,
    retailValue,
    costValue,
    marginValue: round2(retailValue - costValue),
    marginPercent:
      retailValue === 0 ? 0 : round2(((retailValue - costValue) / retailValue) * 100),
    outOfStock,
    lowStock,
    inStock,
    atRiskValue: round2(atRiskValue),
  };
}

/** A catalog line that has dropped to or below its low-stock threshold. */
export type StockAlert = {
  id: string;
  name: string;
  sku: string;
  stock: number;
  /** Effective cutoff for this product (category override, else 10). */
  threshold: number;
  /** "out" or "low". */
  status: "out" | "low";
  categoryName: string;
  /** Retail value of what is left - the urgency number for a restock list. */
  valueAtRisk: number;
};

/**
 * The lines a storekeeper must act on, worst first.
 *
 * Ordering is deliberate: fully out-of-stock lines lead (they cannot sell at
 * all), then the lowest stock-to-threshold ratio (closest to running out), then
 * by value at risk. Sorting purely by stock would put a 1-unit item with a
 * threshold of 50 below a 9-unit item with a threshold of 10, which is the
 * opposite of urgent.
 */
export function stockAlerts(products: ProductLike[], limit = 10): StockAlert[] {
  const alerts: StockAlert[] = [];
  for (const p of products) {
    const threshold = thresholdFor(p);
    const stock = p.stock ?? 0;
    if (stock >= threshold) continue;
    alerts.push({
      id: p.id,
      name: p.name,
      sku: p.sku,
      stock,
      threshold,
      status: stock <= 0 ? "out" : "low",
      categoryName: p.category?.name ?? "Uncategorized",
      valueAtRisk: round2(stock * p.price),
    });
  }
  alerts.sort((a, b) =>
    a.status === b.status
      ? a.stock / a.threshold - b.stock / b.threshold ||
        b.valueAtRisk - a.valueAtRisk
      : a.status === "out"
        ? -1
        : 1,
  );
  return alerts.slice(0, limit);
}

/** Per-category catalog rollup for the inventory insights panel. */
export type CategoryInsight = {
  name: string;
  skus: number;
  units: number;
  retailValue: number;
  outOfStock: number;
  lowStock: number;
  /** Share of total catalog units, 0-100. */
  unitShare: number;
};

/**
 * Roll the catalog up by category.
 *
 * Uncategorized products are kept as their own row rather than merged away, so
 * "Uncategorized" is visibly the pile it is and can be tidied.
 */
export function categoryInsights(products: ProductLike[]): CategoryInsight[] {
  const groups = new Map<
    string,
    {
      skus: number;
      units: number;
      retailValue: number;
      outOfStock: number;
      lowStock: number;
    }
  >();
  let totalUnits = 0;

  for (const p of products) {
    const name = p.category?.name ?? "Uncategorized";
    const cur = groups.get(name) ?? {
      skus: 0,
      units: 0,
      retailValue: 0,
      outOfStock: 0,
      lowStock: 0,
    };
    const stock = p.stock ?? 0;
    cur.skus += 1;
    cur.units += stock;
    cur.retailValue += stock * p.price;
    if (stock <= 0) cur.outOfStock += 1;
    else if (stock < thresholdFor(p)) cur.lowStock += 1;
    groups.set(name, cur);
    totalUnits += stock;
  }

  return [...groups.entries()]
    .map(([name, g]) => ({
      name,
      skus: g.skus,
      units: g.units,
      retailValue: round2(g.retailValue),
      outOfStock: g.outOfStock,
      lowStock: g.lowStock,
      unitShare: totalUnits === 0 ? 0 : round2((g.units / totalUnits) * 100),
    }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}
// -- Refunds & voids -----------------------------------------------------------

/** One refunded line, for the refund/void summary card. */
export type RefundLike = {
  id: string;
  amount: number;
  reason: string | null;
  createdAt: Date;
  items?: { quantity: number }[];
};

/** One voided sale, for the same card. */
export type VoidLike = {
  id: string;
  totalAmount: number;
  voidReason: string | null;
  voidedAt: Date | null;
};

/** Aggregate of everything given back or thrown away in a window. */
export type AdjustmentSummary = {
  refundCount: number;
  refundTotal: number;
  refundUnits: number;
  voidCount: number;
  voidTotal: number;
  /** `refundTotal + voidTotal` - the window's total leakage, as one number. */
  totalGivenBack: number;
  /** Leakage as a percentage of gross sales, or null when there were no sales. */
  ratePercent: number | null;
  /** The most-used refund reason, or null when there were no refunds. */
  topReason: { reason: string; count: number } | null;
};

/**
 * Summarize refunds and voids in one pass.
 *
 * `ratePercent` is deliberately nullable: with no sales there is no meaningful
 * rate, and rendering "0%" would imply a clean day rather than a closed till.
 */
export function adjustmentSummary(
  refunds: RefundLike[],
  voids: VoidLike[],
  range: { from: string; to: string },
  grossSales: number,
): AdjustmentSummary {
  let refundCount = 0;
  let refundTotal = 0;
  let refundUnits = 0;
  const reasons = new Map<string, number>();

  for (const refund of refunds) {
    if (!inRange(refund.createdAt, range)) continue;
    refundCount += 1;
    refundTotal += refund.amount;
    for (const item of refund.items ?? []) refundUnits += item.quantity;
    const reason = refund.reason?.trim() || "No reason given";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  let voidCount = 0;
  let voidTotal = 0;
  for (const v of voids) {
    if (!v.voidedAt || !inRange(v.voidedAt, range)) continue;
    voidCount += 1;
    voidTotal += v.totalAmount;
  }

  let topReason: AdjustmentSummary["topReason"] = null;
  for (const [reason, count] of reasons) {
    if (!topReason || count > topReason.count) topReason = { reason, count };
  }

  refundTotal = round2(refundTotal);
  voidTotal = round2(voidTotal);
  return {
    refundCount,
    refundTotal,
    refundUnits,
    voidCount,
    voidTotal,
    totalGivenBack: round2(refundTotal + voidTotal),
    ratePercent:
      grossSales === 0 ? null : round2(((refundTotal + voidTotal) / grossSales) * 100),
    topReason,
  };
}
// -- Employee performance ------------------------------------------------------

/** The minimum a `User` needs for the performance table. */
export type EmployeeLike = {
  id: string;
  name: string;
  role: string;
  active: boolean;
};

/** One employee's trading record over a window. */
export type EmployeePerformance = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  revenue: number;
  transactions: number;
  averageOrder: number;
  units: number;
  refundCount: number;
  refundTotal: number;
  voidCount: number;
  /** `refundTotal` for this person - the sum they actually processed. */
  givenBack: number;
  /** `givenBack` as a share of this person's gross, 0-100. */
  givenBackPercent: number;
  /** Hours between this person's first and last sale; 0 when under two sales. */
  spanHours: number;
  /** Shifts overlapping the window. */
  shifts: number;
  /** Hours actually clocked, summed across those shifts. */
  hoursWorked: number;
};

/** A `Shift` row, for the hours-worked column. */
export type ShiftLike = { employeeId: string; clockIn: Date; clockOut: Date | null };

/**
 * Build the per-employee performance table.
 *
 * Employees with no sales in the window are STILL returned (with zeroes) when
 * they appear in `employees`. A shift worker who has not rung anything up yet
 * is information a manager wants on screen - "0 transactions" is a different
 * fact from "not on shift today" - and dropping them would make the table look
 * complete when it is not.
 *
 * This is a sales-activity report, deliberately NOT payroll: it counts what was
 * sold and given back, never hours x rate, because the schema stores no
 * compensation data and inventing one would be misleading.
 */
export function employeePerformance(
  employees: EmployeeLike[],
  sales: SaleForTotals[],
  refunds: (RefundLike & { processedById?: string | null })[],
  voids: (VoidLike & { voidedById?: string | null })[],
  range: { from: string; to: string },
  shifts: ShiftLike[] = [],
): EmployeePerformance[] {
  const byId = new Map<string, EmployeePerformance>();
  for (const e of employees) {
    byId.set(e.id, {
      id: e.id,
      name: e.name,
      role: e.role,
      active: e.active,
      revenue: 0,
      transactions: 0,
      averageOrder: 0,
      units: 0,
      refundCount: 0,
      refundTotal: 0,
      voidCount: 0,
      givenBack: 0,
      givenBackPercent: 0,
      spanHours: 0,
      shifts: 0,
      hoursWorked: 0,
    });
  }

  // First/last sale timestamps per person, for the trading-span column.
  const stamps = new Map<string, { first: number; last: number }>();
  const grossById = new Map<string, number>();

  for (const sale of sales) {
    const id = sale.cashierId;
    if (!id || !byId.has(id)) continue;
    if (!inRange(sale.createdAt, range)) continue;
    const row = byId.get(id)!;
    if (isRevenueSale(sale.status)) {
      row.transactions += 1;
      row.revenue += netSaleAmount(sale);
      row.units += (sale.items ?? []).reduce((n, i) => n + i.quantity, 0);
      grossById.set(id, (grossById.get(id) ?? 0) + sale.totalAmount);
    }
    const t = sale.createdAt.getTime();
    const s = stamps.get(id);
    if (!s) stamps.set(id, { first: t, last: t });
    else {
      s.first = Math.min(s.first, t);
      s.last = Math.max(s.last, t);
    }
  }

  for (const refund of refunds) {
    const id = refund.processedById;
    if (!id || !byId.has(id) || !inRange(refund.createdAt, range)) continue;
    const row = byId.get(id)!;
    row.refundCount += 1;
    row.refundTotal += refund.amount;
  }

  for (const v of voids) {
    const id = v.voidedById;
    if (!id || !byId.has(id) || !v.voidedAt || !inRange(v.voidedAt, range)) continue;
    byId.get(id)!.voidCount += 1;
  }

  const fromMs = parseLocalDate(range.from).getTime();
  const toExclusiveMs = addDays(parseLocalDate(range.to), 1).getTime();
  for (const shift of shifts) {
    const row = byId.get(shift.employeeId);
    if (!row) continue;
    // A shift that ended before the window, or starts after it, is not ours.
    if (shift.clockOut && shift.clockOut.getTime() < fromMs) continue;
    if (shift.clockIn.getTime() >= toExclusiveMs) continue;
    row.shifts += 1;
    if (shift.clockOut) {
      row.hoursWorked +=
        (shift.clockOut.getTime() - shift.clockIn.getTime()) / 3_600_000;
    }
  }

  return [...byId.values()]
    .map((row) => {
      const s = stamps.get(row.id);
      const gross = grossById.get(row.id) ?? 0;
      const givenBack = round2(row.refundTotal);
      return {
        ...row,
        revenue: round2(row.revenue),
        refundTotal: givenBack,
        givenBack,
        averageOrder:
          row.transactions === 0 ? 0 : round2(row.revenue / row.transactions),
        givenBackPercent: gross === 0 ? 0 : round2((givenBack / gross) * 100),
        spanHours:
          s && s.last > s.first ? round2((s.last - s.first) / 3_600_000) : 0,
        hoursWorked: round2(row.hoursWorked),
      };
    })
    .sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.transactions - a.transactions ||
        a.name.localeCompare(b.name),
    );
}
// -- Supplier performance ------------------------------------------------------

/** One supplier's ordering record over a window. */
export type SupplierPerformance = {
  id: string;
  name: string;
  /** Purchase orders raised in the window, excluding cancelled ones. */
  orders: number;
  /** Ordered value = ordered quantity x the PO line's unit cost. */
  orderedValue: number;
  /** Value actually received, valued at the PO line's unit cost. */
  receivedValue: number;
  /** Units received. */
  receivedUnits: number;
  /** POs still waiting on delivery (DRAFT / ORDERED / PARTIALLY_RECEIVED). */
  openOrders: number;
  /** Value of the quantity still outstanding on those open POs. */
  outstandingValue: number;
  /** Average days from ordering to the FIRST receipt, or null if unreceived. */
  averageLeadDays: number | null;
  /** Distinct products this supplier is the recorded supplier for. */
  catalogSkus: number;
};

/** The minimum a `PurchaseOrder` needs. */
export type PurchaseOrderLike = {
  id: string;
  supplierId: string | null;
  status: string;
  createdAt: Date;
  items?: { orderedQty: number; receivedQty: number; unitCost: number }[];
};

/** A `PurchaseReceipt` for lead-time measurement. */
export type ReceiptLike = {
  purchaseOrderId: string;
  receivedAt: Date;
  items?: { receivedQty: number }[];
};

/**
 * PO statuses that still owe stock.
 *
 * `CANCELLED` is excluded - nothing is owed - and `RECEIVED` is complete by
 * definition. Everything else in this set is real money committed but not yet
 * on the shelf.
 */
const OPEN_PO_STATUSES = new Set(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"]);

/**
 * Per-supplier ordering, receiving and outstanding-value rollup.
 *
 * `averageLeadDays` measures order date -> FIRST receipt, averaged per
 * supplier. Using the first receipt is what a storekeeper actually experiences
 * as lead time; a backordered line arriving in three instalments would
 * otherwise report a lead time three times too long.
 */
export function supplierPerformance(
  suppliers: { id: string; name: string }[],
  orders: PurchaseOrderLike[],
  receipts: ReceiptLike[],
  catalogCounts: Map<string, number> = new Map(),
  range: { from: string; to: string } = { from: "0000-01-01", to: "9999-12-31" },
): SupplierPerformance[] {
  const byId = new Map<string, SupplierPerformance>();
  for (const s of suppliers) {
    byId.set(s.id, {
      id: s.id,
      name: s.name,
      orders: 0,
      orderedValue: 0,
      receivedValue: 0,
      receivedUnits: 0,
      openOrders: 0,
      outstandingValue: 0,
      averageLeadDays: null,
      catalogSkus: catalogCounts.get(s.id) ?? 0,
    });
  }

  // unitCost per PO, so a receipt can be valued without a second query.
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const firstReceipt = new Set<string>();
  const leadSum = new Map<string, number>();
  const leadCount = new Map<string, number>();

  for (const receipt of receipts) {
    const order = orderById.get(receipt.purchaseOrderId);
    const supplierId = order?.supplierId;
    if (!order || !supplierId) continue;
    const row = byId.get(supplierId);
    if (!row) continue;

    const units = (receipt.items ?? []).reduce((n, i) => n + i.receivedQty, 0);
    row.receivedUnits += units;
    // Received value is valued at the PO's own unit cost. Receiving
    // deliberately does NOT rewrite Product.cost (see `receiveStock`), so the
    // PO line price is the only defensible cost basis available here.
    const unitCost = order.items?.[0]?.unitCost ?? 0;
    row.receivedValue = round2(row.receivedValue + units * unitCost);

    if (!firstReceipt.has(order.id)) {
      firstReceipt.add(order.id);
      if (inRange(receipt.receivedAt, range)) {
        const days =
          (receipt.receivedAt.getTime() - order.createdAt.getTime()) / 86_400_000;
        if (days >= 0) {
          leadSum.set(supplierId, (leadSum.get(supplierId) ?? 0) + days);
          leadCount.set(supplierId, (leadCount.get(supplierId) ?? 0) + 1);
        }
      }
    }
  }

  for (const order of orders) {
    const supplierId = order.supplierId;
    if (!supplierId) continue;
    const row = byId.get(supplierId);
    if (!row) continue;
    if (!inRange(order.createdAt, range)) continue;
    if (order.status === "CANCELLED") continue;

    row.orders += 1;
    for (const item of order.items ?? []) {
      row.orderedValue = round2(row.orderedValue + item.orderedQty * item.unitCost);
      if (OPEN_PO_STATUSES.has(order.status)) {
        const outstanding = Math.max(0, item.orderedQty - item.receivedQty);
        row.outstandingValue = round2(
          row.outstandingValue + outstanding * item.unitCost,
        );
      }
    }
    if (OPEN_PO_STATUSES.has(order.status)) row.openOrders += 1;
  }

  return [...byId.values()]
    .map((row) => {
      const count = leadCount.get(row.id) ?? 0;
      return {
        ...row,
        averageLeadDays:
          count === 0 ? null : round2((leadSum.get(row.id) ?? 0) / count),
      };
    })
    .sort(
      (a, b) =>
        b.orderedValue - a.orderedValue ||
        b.orders - a.orders ||
        a.name.localeCompare(b.name),
    );
}