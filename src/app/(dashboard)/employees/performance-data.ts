import { prisma } from "@/lib/db";
import { requirePageAuth } from "@/lib/session";
import {
  employeePerformance,
  previousRange,
  rangeFor,
  rangeWindow,
  resolveRange,
  percentChange,
  type EmployeePerformance,
  type RangeKey,
} from "@/lib/analytics";

/**
 * Per-employee trading performance for a window (Phase 2).
 *
 * This is deliberately a SALES-ACTIVITY report, not payroll. The schema stores
 * no compensation data, so any "earnings" figure here would be invented. What
 * it does report is what each person actually rang up, what they processed back
 * out, and when they were on the clock — which is what a manager is deciding
 * about when they look at this screen.
 *
 * Every employee in `employees` is returned, including ones with no sales in the
 * window: "0 transactions" and "not on shift today" are different facts, and
 * dropping the quiet rows would make the table look complete when it is not.
 */
export type EmployeePerformanceData = {
  range: { from: string; to: string };
  previous: { from: string; to: string };
  rows: EmployeePerformance[];
  /** Store-wide revenue in the window, for the share column. */
  storeRevenue: number;
  /** Headline totals across everyone. */
  totals: {
    revenue: number;
    transactions: number;
    refunds: number;
    refundTotal: number;
    voids: number;
    voidTotal: number;
  };
  revenueChange: number | null;
};

/**
 * Load the performance table.
 *
 * Auth first: this is staff-wide data. `requirePageAuth` throws for an anonymous
 * visitor, so no individual query below can forget the guard.
 */
export async function getEmployeePerformance(
  rawRange: string | string[] | undefined,
): Promise<EmployeePerformanceData> {
  await requirePageAuth();

  const rangeKey: RangeKey = resolveRange(rawRange);
  const range = rangeFor(rangeKey);
  const previous = previousRange(range);
  const current = rangeWindow(range);
  const prior = rangeWindow(previous);
  const from = current.gte <= prior.gte ? current.gte : prior.gte;
  const to = current.lt > prior.lt ? current.lt : prior.lt;

  const [users, sales, refunds, shifts] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, role: true, active: true } }),
    prisma.sale.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        refundedAmount: true,
        paymentMethod: true,
        createdAt: true,
        cashierId: true,
        customerId: true,
        voidedAt: true,
        voidedBy: true,
        voidReason: true,
        items: { select: { quantity: true } },
      },
    }),
    prisma.saleRefund.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: {
        id: true,
        amount: true,
        reason: true,
        createdAt: true,
        cashierId: true,
      },
    }),
    prisma.shift.findMany({
      select: { id: true, userId: true, start: true, end: true },
    }),
  ]);

  // Voided sales are read off the same sale rows rather than a second query, so
  // the "given back" figures can never describe a different window than the
  // revenue beside them.
  const voids = sales
    .filter((s) => s.status === "Voided" && s.voidedAt)
    .map((s) => ({
      id: s.id,
      totalAmount: s.totalAmount,
      voidReason: s.voidReason,
      voidedAt: s.voidedAt,
      voidedBy: s.voidedBy,
    }));

  // The `Shift` model calls its columns `start`/`end`; `ShiftLike` calls them
  // `clockIn`/`clockOut` to read unambiguously beside a sale timestamp. Map
  // here rather than renaming one of the two, so neither convention is
  // disturbed for its existing callers.
  const shiftLike = shifts.map((s) => ({
    employeeId: s.userId,
    clockIn: s.start,
    clockOut: s.end,
  }));

  const rows = employeePerformance(users, sales, refunds, voids, range, shiftLike);

  const inCurrent = sales.filter(
    (s) => s.createdAt >= current.gte && s.createdAt < current.lt,
  );
  const inPrior = sales.filter(
    (s) => s.createdAt >= prior.gte && s.createdAt < prior.lt,
  );
  const sumRevenue = (list: typeof sales) =>
    Math.round(
      list
        .filter((s) => s.status === "Completed" || s.status === "Partially Refunded")
        .reduce(
          (n, s) => n + Math.max(0, s.totalAmount - (s.refundedAmount ?? 0)),
          0,
        ) * 100,
    ) / 100;

  const storeRevenue = sumRevenue(inCurrent);
  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      transactions: acc.transactions + r.transactions,
      refunds: acc.refunds + r.refundCount,
      refundTotal: acc.refundTotal + r.givenBack,
      voids: acc.voids + r.voidCount,
      voidTotal: acc.voidTotal + 0,
    }),
    { revenue: 0, transactions: 0, refunds: 0, refundTotal: 0, voids: 0, voidTotal: 0 },
  );
  totals.revenue = Math.round(totals.revenue * 100) / 100;
  totals.refundTotal = Math.round(totals.refundTotal * 100) / 100;
  totals.voidTotal = Math.round(voids.reduce((n, v) => n + v.totalAmount, 0) * 100) / 100;

  return {
    range,
    previous,
    rows,
    storeRevenue,
    totals: { ...totals, revenue: storeRevenue },
    revenueChange: percentChange(storeRevenue, sumRevenue(inPrior)),
  };
}