import { prisma } from "@/lib/db";
import { requirePageAuth } from "@/lib/session";
import {
  previousRange,
  rangeFor,
  rangeWindow,
  resolveRange,
  supplierPerformance,
  type SupplierPerformance,
} from "@/lib/analytics";

/**
 * Supplier ordering and receiving performance for a window (Phase 2).
 *
 * Reports only what the existing schema can answer honestly: how much was
 * ordered, how much has actually arrived, how many POs are still open, and how
 * long the wait has been. It does NOT score or rank suppliers - the schema has
 * no quality, price-variance or on-time-contract data, so any "supplier
 * rating" built here would be an invention dressed as a measurement.
 *
 * Lead time is measured to the FIRST receipt, because that is the wait a
 * storekeeper actually experiences; a backordered line arriving in three
 * instalments would otherwise report a lead time three times too long.
 */
export type SupplierPerformanceData = {
  range: { from: string; to: string };
  rows: SupplierPerformance[];
  /** Aggregate position across every supplier, for the headline tiles. */
  totals: {
    suppliers: number;
    orders: number;
    orderedValue: number;
    receivedValue: number;
    openOrders: number;
    outstandingValue: number;
    /** Mean lead time across suppliers that have received anything, or null. */
    averageLeadDays: number | null;
  };
  /** The PO statuses still waiting, for the "outstanding" summary strip. */
  openByStatus: { status: string; count: number; value: number }[];
};

export async function getSupplierPerformance(
  rawRange: string | string[] | undefined,
): Promise<SupplierPerformanceData> {
  await requirePageAuth();

  const rangeKey = resolveRange(rawRange);
  const range = rangeFor(rangeKey);
  const window = rangeWindow(range);
  const previous = previousRange(range);
  const from = new Date(Math.min(window.gte.getTime(), parseISO(previous.from).getTime()));
  const to = new Date(
    Math.max(window.lt.getTime(), parseISO(previous.to).getTime() + 86_400_000),
  );

  const [suppliers, orders, receipts, products] = await Promise.all([
    prisma.supplier.findMany({ select: { id: true, name: true } }),
    prisma.purchaseOrder.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: {
        id: true,
        supplierId: true,
        status: true,
        createdAt: true,
        items: { select: { orderedQty: true, receivedQty: true, unitCost: true } },
      },
    }),
    prisma.purchaseReceipt.findMany({
      where: { receivedAt: { gte: from, lt: to } },
      select: {
        purchaseOrderId: true,
        receivedAt: true,
        items: { select: { receivedQty: true } },
      },
    }),
    prisma.product.findMany({
      select: { supplierId: true },
    }),
  ]);

  // How many catalog lines each supplier is the recorded supplier for. Tells a
  // storekeeper how exposed they are to any single vendor.
  const catalogCounts = new Map<string, number>();
  for (const p of products) {
    if (!p.supplierId) continue;
    catalogCounts.set(p.supplierId, (catalogCounts.get(p.supplierId) ?? 0) + 1);
  }

  const rows = supplierPerformance(suppliers, orders, receipts, catalogCounts, range);

  const OPEN = new Set(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"]);
  const byStatus = new Map<string, { count: number; value: number }>();
  for (const order of orders) {
    if (!OPEN.has(order.status)) continue;
    const value = (order.items ?? []).reduce(
      (n, i) => n + Math.max(0, i.orderedQty - i.receivedQty) * i.unitCost,
      0,
    );
    const slot = byStatus.get(order.status) ?? { count: 0, value: 0 };
    slot.count += 1;
    slot.value = Math.round((slot.value + value) * 100) / 100;
    byStatus.set(order.status, slot);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const leads = rows
    .map((r) => r.averageLeadDays)
    .filter((d): d is number => d != null);

  return {
    range,
    rows,
    totals: {
      suppliers: suppliers.length,
      orders: rows.reduce((n, r) => n + r.orders, 0),
      orderedValue: round(rows.reduce((n, r) => n + r.orderedValue, 0)),
      receivedValue: round(rows.reduce((n, r) => n + r.receivedValue, 0)),
      openOrders: rows.reduce((n, r) => n + r.openOrders, 0),
      outstandingValue: round(rows.reduce((n, r) => n + r.outstandingValue, 0)),
      averageLeadDays:
        leads.length === 0
          ? null
          : round(leads.reduce((n, d) => n + d, 0) / leads.length),
    },
    openByStatus: [...byStatus.entries()]
      .map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => b.value - a.value),
  };
}

/** Local midnight for `YYYY-MM-DD`, matching the analytics date convention. */
function parseISO(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}