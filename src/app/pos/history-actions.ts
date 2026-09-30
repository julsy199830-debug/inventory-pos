"use server";

import { prisma } from "@/lib/db";
import { requireCashierSession, NoCashierError } from "@/lib/session";
import type { MutationResult } from "@/lib/types";
import {
  HISTORY_LIMIT,
  type HistoryFacets,
  type HistoryFilters,
  type HistoryScope,
  type SaleDetailsEntry,
  type SaleHistoryEntry,
} from "./history-types";

/**
 * POS transaction-history lookups.
 *
 * Read-only Server Actions backing the "Transactions" panel on the register.
 * Kept in their own file (rather than `actions/sales.ts`) so the mutation file
 * stays focused on checkout/void, and so the history queries can be evolved
 * independently (pagination, richer search) without touching the checkout path.
 *
 * Security: both actions require a signed-in cashier session — the sales ledger
 * (customer names, cashier attribution, tendered/change) must not be readable by
 * an anonymous visitor. Void *authorization* is NOT checked here: viewing a
 * sale is allowed for any signed-in staff; actually voiding stays gated inside
 * `voidSale()` (ADMIN/MANAGER, server-enforced).
 */

// Shared shapes + the HISTORY_LIMIT constant live in `./history-types` — a
// `"use server"` module may only export async functions.

/**
 * Fetch the most recent transactions, newest first.
 *
 * Server-side filtering: `query` matches sale id, customer name, or cashier
 * name (contains, case-insensitive by SQLite's default LIKE collation);
 * `scope` narrows to today or the last 7 days. Limited to {@link HISTORY_LIMIT}
 * rows so the register never loads the whole sales table.
 *
 * Phase 3 accepts the full {@link HistoryFilters} set. Every predicate is
 * additive and optional, and each is resolved to a bounded value before it
 * reaches Prisma: a malformed `from`/`to` falls back to the `scope` window
 * rather than producing an unparseable `Date` and a 500.
 */
export async function getRecentSales(
  input: HistoryFilters,
): Promise<MutationResult<{ sales: SaleHistoryEntry[] }>> {
  try {
    await requireCashierSession();
  } catch (err) {
    if (err instanceof NoCashierError) {
      return { ok: false, error: "Sign in to the register to view transactions." };
    }
    throw err;
  }

  const query = (input?.query ?? "").trim();
  const scope: HistoryScope = input?.scope === "today" ? "today" : "recent";

  // Local wall-clock day bounds. `new Date("YYYY-MM-DD")` would parse as UTC
  // midnight and drop the wrong day's sales in a negative-offset zone, so the
  // string is split and constructed locally - the same convention as
  // `parseLocalDate` in lib/analytics.
  const from = localDayStart(input?.from);
  const to = localDayEnd(input?.to);

  const createdAt: Record<string, Date> = {};
  if (from) createdAt.gte = from;
  if (to) createdAt.lt = to;
  // Only fall back to the coarse preset when no explicit range was given.
  if (!from && !to) {
    createdAt.gte =
      scope === "today"
        ? new Date(new Date().setHours(0, 0, 0, 0))
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  const sales = await prisma.sale.findMany({
    where: {
      createdAt,
      ...(input?.status ? { status: input.status } : {}),
      ...(input?.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
      ...(input?.cashierId ? { cashierId: input.cashierId } : {}),
      ...(input?.customerId ? { customerId: input.customerId } : {}),
      ...(query
        ? {
            OR: [
              { id: { contains: query } },
              { customer: { name: { contains: query } } },
              { cashier: { name: { contains: query } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      paymentMethod: true,
      status: true,
      refundedAmount: true,
      cashier: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });

  return {
    ok: true,
    data: {
      sales: sales.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        totalAmount: s.totalAmount,
        paymentMethod: s.paymentMethod,
        status: s.status,
        refundedAmount: s.refundedAmount,
        cashierName: s.cashier?.name ?? null,
        customerName: s.customer?.name ?? null,
      })),
    },
  };
}

/** Local midnight for a `YYYY-MM-DD`, or null when absent/malformed. */
function localDayStart(iso: string | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/**
 * Exclusive upper bound for a `YYYY-MM-DD`: the next local midnight.
 *
 * Half-open so a sale recorded in the final millisecond of the chosen day is
 * included, and so it composes with Prisma's `lt` on a `DateTime`.
 */
function localDayEnd(iso: string | undefined): Date | null {
  const start = localDayStart(iso);
  if (!start) return null;
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return next;
}

/**
 * The distinct cashier / customer / status / payment values that actually
 * occur, with counts, for the history filter dropdowns.
 *
 * Derived from the data rather than a fixed list, so a cashier who has only
 * ever taken card is not offered a cash option that would always come back
 * empty. Scoped to the same window the list uses, so the counts agree with what
 * the manager is actually looking at.
 */
export async function getHistoryFacets(
  input: { scope?: HistoryScope } = {},
): Promise<MutationResult<HistoryFacets>> {
  try {
    await requireCashierSession();
  } catch (err) {
    if (err instanceof NoCashierError) {
      return { ok: false, error: "Sign in to the register to view transactions." };
    }
    throw err;
  }

  const scope: HistoryScope = input?.scope === "today" ? "today" : "recent";
  const since =
    scope === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0))
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [cashiers, customers, statuses, payments] = await Promise.all([
    prisma.sale.groupBy({ by: ["cashierId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.sale.groupBy({ by: ["customerId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.sale.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.sale.groupBy({ by: ["paymentMethod"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
  ]);

  // Resolve the ids groupBy returned into names. Walk-in sales have no
  // customerId, so those groups are dropped rather than shown as a blank option.
  const cashierIds = cashiers.map((g) => g.cashierId).filter((id): id is string => id != null);
  const customerIds = customers.map((g) => g.customerId).filter((id): id is string => id != null);

  const [userRows, customerRows] = await Promise.all([
    cashierIds.length
      ? prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    customerIds.length
      ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const userName = new Map(userRows.map((u) => [u.id, u.name]));
  const customerName = new Map(customerRows.map((c) => [c.id, c.name]));

  return {
    ok: true,
    data: {
      cashiers: cashiers
        .filter((g) => g.cashierId && userName.has(g.cashierId))
        .map((g) => ({
          value: g.cashierId as string,
          label: userName.get(g.cashierId as string) as string,
          count: g._count._all,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      customers: customers
        .filter((g) => g.customerId && customerName.has(g.customerId))
        .map((g) => ({
          value: g.customerId as string,
          label: customerName.get(g.customerId as string) as string,
          count: g._count._all,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      statuses: statuses
        .map((g) => ({ value: g.status, label: g.status, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      paymentMethods: payments
        .map((g) => ({ value: g.paymentMethod, label: g.paymentMethod, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

/**
 * Fetch the full detail of one sale (items with product names, totals,
 * tendered/change, void metadata). Called only when a row is selected, so
 * items are never fetched for the list view.
 */
export async function getSaleDetails(
  saleId: string,
): Promise<MutationResult<{ sale: SaleDetailsEntry }>> {
  try {
    await requireCashierSession();
  } catch (err) {
    if (err instanceof NoCashierError) {
      return { ok: false, error: "Sign in to the register to view transactions." };
    }
    throw err;
  }

  const id = (saleId ?? "").trim();
  if (!id) {
    return { ok: false, error: "Sale ID is required." };
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      subtotal: true,
      discountAmount: true,
      tax: true,
      paymentMethod: true,
      status: true,
      tendered: true,
      change: true,
      voidReason: true,
      voidedAt: true,
      voidedBy: true,
      redeemedPoints: true,
      redemptionAmount: true,
      earnedPoints: true,
      refundedAmount: true,
      cashier: { select: { name: true } },
      customer: { select: { name: true } },
      refunds: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amount: true,
          reason: true,
          createdAt: true,
          cashier: { select: { name: true } },
        },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          refundedQuantity: true,
          priceAtSale: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  if (!sale) {
    return { ok: false, error: "Sale not found." };
  }

  return {
    ok: true,
    data: {
      sale: {
        id: sale.id,
        createdAt: sale.createdAt.toISOString(),
        totalAmount: sale.totalAmount,
        subtotal: sale.subtotal,
        discountAmount: sale.discountAmount,
        tax: sale.tax,
        paymentMethod: sale.paymentMethod,
        status: sale.status,
        tendered: sale.tendered,
        change: sale.change,
        voidReason: sale.voidReason,
        voidedAt: sale.voidedAt ? sale.voidedAt.toISOString() : null,
        voidedBy: sale.voidedBy,
        redeemedPoints: sale.redeemedPoints,
        redemptionAmount: sale.redemptionAmount,
        earnedPoints: sale.earnedPoints,
        refundedAmount: sale.refundedAmount,
        cashierName: sale.cashier?.name ?? null,
        customerName: sale.customer?.name ?? null,
        items: sale.items.map((it) => ({
          id: it.id,
          productName: it.product?.name ?? "Unknown product",
          quantity: it.quantity,
          refundedQuantity: it.refundedQuantity,
          priceAtSale: it.priceAtSale,
        })),
        refunds: sale.refunds.map((r) => ({
          id: r.id,
          amount: r.amount,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
          cashierName: r.cashier?.name ?? null,
        })),
      },
    },
  };
}
