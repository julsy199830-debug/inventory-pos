"use server";

import { prisma } from "@/lib/db";
import { requireCashierSession, NoCashierError } from "@/lib/session";
import type { MutationResult } from "@/lib/types";
import {
  HISTORY_LIMIT,
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
 */
export async function getRecentSales(
  input: { query?: string; scope?: HistoryScope },
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
  const since =
    scope === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0))
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const sales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: since },
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
        cashierName: s.cashier?.name ?? null,
        customerName: s.customer?.name ?? null,
      })),
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
      cashier: { select: { name: true } },
      customer: { select: { name: true } },
      items: {
        select: {
          id: true,
          quantity: true,
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
        cashierName: sale.cashier?.name ?? null,
        customerName: sale.customer?.name ?? null,
        items: sale.items.map((it) => ({
          id: it.id,
          productName: it.product?.name ?? "Unknown product",
          quantity: it.quantity,
          priceAtSale: it.priceAtSale,
        })),
      },
    },
  };
}
