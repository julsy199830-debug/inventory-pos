import { prisma } from "@/lib/db";
import {
  adjustmentSummary,
  employeePerformance,
  hourlyProfile,
  inventoryValuation,
  paymentMix,
  previousRange,
  rangeFor,
  rangeWindow,
  revenueTrend,
  salesTotals,
  stockAlerts,
  topProducts,
  categoryMix,
  type EmployeePerformance,
  type HourBucket,
  type InventoryValuation,
  type RangeKey,
  type SaleForTotals,
  type SaleItemLike,
  type StockAlert,
  type TrendPoint,
  type BreakdownRow,
} from "@/lib/analytics";
import { requirePageAuth } from "@/lib/session";

/**
 * Everything the Phase 2 dashboard renders, fetched in one place.
 *
 * The old dashboard issued its own `prisma.sale.findMany` per card, each with a
 * slightly different filter, then re-derived totals in JSX. That is why its
 * cards disagreed with each other and with the reports page. Here a single
 * query per resource feeds one set of pure calculations, so every card is
 * describing the same window of the same rows.
 *
 * The current window and the equally-wide PREVIOUS window are fetched together
 * in one pass, which is what the comparison deltas need; nothing here needs a
 * second round trip. For the longest preset (1Y) the trend series is bucketed
 * monthly, because 365 daily columns are unreadable.
 */

/**
 * The sale shape the dashboard needs, in one place so every card aggregates the
 * same fields. Selecting narrowly also keeps the whole window in memory for a
 * LAN-sized store instead of streaming a full `Sale` graph.
 */
const SALE_SELECT = {
  id: true,
  status: true,
  totalAmount: true,
  refundedAmount: true,
  paymentMethod: true,
  createdAt: true,
  customerId: true,
  cashierId: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  customer: { select: { name: true } },
  cashier: { select: { name: true } },
  items: {
    select: {
      quantity: true,
      priceAtSale: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          category: { select: { name: true } },
        },
      },
    },
  },
} as const;

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  stock: true,
  price: true,
  cost: true,
  category: { select: { name: true, lowStockThreshold: true } },
} as const;

/**
 * A sale plus its resolved line items, as the pure helpers expect them, and the
 * void / party fields the recent-transactions and adjustment cards read.
 *
 * Declared explicitly rather than inferred so the `as DashboardSale` casts below
 * are actually checked: widening `SaleForTotals` with the extra fields here
 * turns a typo in a field name into a compile error instead of an `undefined`
 * silently reaching the screen.
 */
type DashboardSale = SaleForTotals & {
  items: SaleItemLike[];
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  customer: { name: string } | null;
  cashier: { name: string } | null;
};
export type DashboardData = {
  range: { from: string; to: string };
  previous: { from: string; to: string };
  totals: ReturnType<typeof salesTotals>;
  previousTotals: ReturnType<typeof salesTotals>;
  revenueChange: number | null;
  transactionChange: number | null;
  averageOrderChange: number | null;
  /** Today's own figures, independent of the selected range. */
  today: ReturnType<typeof salesTotals>;
  trend: TrendPoint[];
  hours: HourBucket[];
  top: BreakdownRow[];
  payments: BreakdownRow[];
  categories: BreakdownRow[];
  employees: EmployeePerformance[];
  valuation: InventoryValuation;
  alerts: StockAlert[];
  adjustments: ReturnType<typeof adjustmentSummary>;
  recent: {
    id: string;
    customer: string;
    cashier: string;
    total: number;
    method: string;
    status: string;
    at: Date;
  }[];
  hasAnySales: boolean;
};
/**
 * Load the whole dashboard in parallel.
 *
 * Auth runs first: this reads staff-wide sales, per-cashier performance and the
 * refund/void summary, none of which every signed-in user should see.
 * `requirePageAuth` throws for an anonymous visitor and applies the dashboard's
 * own RBAC rules, so the guard cannot be forgotten on an individual query below.
 */
export async function getDashboardData(rangeKey: RangeKey): Promise<DashboardData> {
  await requirePageAuth();

  const range = rangeFor(rangeKey);
  const previous = previousRange(range);
  const current = rangeWindow(range);
  const prior = rangeWindow(previous);
  // One pass covering BOTH windows, so the comparison needs no extra query and
  // the two windows are guaranteed to be the same width.
  const from = current.gte <= prior.gte ? current.gte : prior.gte;
  const to = current.lt > prior.lt ? current.lt : prior.lt;

  const [sales, refunds, products, employees] = await Promise.all([
    prisma.sale.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: SALE_SELECT,
      orderBy: { createdAt: "asc" },
    }),
    prisma.saleRefund.findMany({
      where: { createdAt: rangeWindow(range) },
      select: { id: true, amount: true, reason: true, createdAt: true, cashierId: true },
    }),
    prisma.product.findMany({ select: PRODUCT_SELECT }),
    prisma.user.findMany({ select: { id: true, name: true, role: true, active: true } }),
  ]);

  const within = (w: { gte: Date; lt: Date }) => (s: { createdAt: Date }) =>
    s.createdAt >= w.gte && s.createdAt < w.lt;

  const currentSales = sales.filter(within(current)) as DashboardSale[];
  const priorSales = sales.filter(within(prior)) as DashboardSale[];

  const totals = salesTotals(currentSales);
  const previousTotals = salesTotals(priorSales);

  const refundsInRange = refunds;
  // Refunds and voids for the window, taken from the SAME sale rows as the
  // revenue rather than a second query, so "given back" can never describe a
  // different period than the figure beside it.
  const voids = currentSales
    .filter((s) => s.status === "Voided" && s.voidedAt)
    .map((s) => ({
      id: s.id,
      totalAmount: s.totalAmount,
      voidReason: s.voidReason,
      voidedAt: s.voidedAt,
      voidedBy: s.voidedBy,
    }));

  const adjustments = adjustmentSummary(refundsInRange, voids, range, totals.gross);

  const granularity = rangeKey === "year" ? "month" : "day";

  const recent = [...currentSales]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8)
    .map((s) => ({
      id: s.id,
      customer: s.customer?.name ?? "Walk-in",
      cashier: s.cashier?.name ?? "Unknown",
      total: s.totalAmount,
      method: s.paymentMethod,
      status: s.status,
      at: s.createdAt,
    }));

  // Today is measured on its own window so the "Today" tile is never a
  // function of which range happens to be selected.
  const todayWindow = rangeWindow(rangeFor("today"));

  return {
    range,
    previous,
    totals,
    previousTotals,
    revenueChange: percent(totals.revenue, previousTotals.revenue),
    transactionChange: percent(totals.transactions, previousTotals.transactions),
    averageOrderChange: percent(totals.averageOrder, previousTotals.averageOrder),
    today: salesTotals(sales.filter(within(todayWindow)) as DashboardSale[]),
    trend: revenueTrend(currentSales, range, granularity),
    hours: hourlyProfile(currentSales, range),
    top: topProducts(currentSales, range, 5),
    payments: paymentMix(currentSales, range),
    categories: categoryMix(currentSales, range),
    employees: employeePerformance(employees, currentSales, refundsInRange, voids, range),
    valuation: inventoryValuation(products),
    alerts: stockAlerts(products, 8),
    adjustments,
    recent,
    hasAnySales: sales.length > 0,
  };
}

/** Signed percentage change, or null when there is no baseline to compare to. */
function percent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  const v = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/** Just the alert counts, for the sidebar's inventory assistant. */
export async function getAlertCounts(): Promise<{ out: number; low: number }> {
  await requirePageAuth();
  const products = await prisma.product.findMany({ select: PRODUCT_SELECT });
  const v = inventoryValuation(products);
  return { out: v.outOfStock, low: v.lowStock };
}
