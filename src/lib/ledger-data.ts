/**
 * Phase 6 — reading the records the ledger is built from.
 *
 * Kept separate from `src/lib/ledger.ts` so the arithmetic stays pure and
 * testable without a database, and so every statement view loads the account the
 * same way. There is exactly ONE definition of "what counts as a movement",
 * and it lives in {@link loadLedgerEvents}.
 *
 * Which records move a balance, and why:
 *
 *   Sale STORE_CREDIT, Completed  -> CHARGE      (the customer owes the total)
 *   Sale STORE_CREDIT, Voided     -> VOID        (net zero, shown for the trail)
 *   SaleRefund on a credit sale   -> REFUND      (returned goods reduce the debt)
 *   CustomerPayment kind=PAYMENT -> PAYMENT     (money received)
 *   AccountAdjustment             -> ADJUSTMENT  (manager correction/write-off)
 *
 * Cash and card sales are NOT listed: they never touched the account, and
 * including them was a bug in the pre-Phase-6 statement.
 *
 * `CustomerPayment.kind = 'VOID_REVERSAL'` is deliberately excluded. The voided
 * sale above is already net zero; counting its synthetic reversal row as a
 * payment too would show the customer a phantom credit.
 */

import { prisma } from "./db";
import type { LedgerEvent } from "./ledger";

/** Short, stable, human-quotable reference for a sale — matches the rest of the app. */
function saleRef(id: string): string {
  return `Sale #${id.slice(0, 8)}`;
}

export async function loadLedgerEvents(
  customerId: string,
): Promise<LedgerEvent[]> {
  const [sales, refunds, payments, adjustments] = await Promise.all([
    prisma.sale.findMany({
      where: { customerId, paymentMethod: "STORE_CREDIT" },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        cashier: { select: { name: true } },
      },
    }),
    prisma.saleRefund.findMany({
      where: { sale: { customerId, paymentMethod: "STORE_CREDIT" } },
      select: {
        id: true,
        amount: true,
        reason: true,
        createdAt: true,
        cashier: { select: { name: true } },
        sale: { select: { id: true } },
      },
    }),
    prisma.customerPayment.findMany({
      where: { customerId, kind: "PAYMENT" },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        notes: true,
        createdAt: true,
        cashier: { select: { name: true } },
      },
    }),
    prisma.accountAdjustment.findMany({
      where: { customerId },
      select: {
        id: true,
        amount: true,
        kind: true,
        reason: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
    }),
  ]);

  const events: LedgerEvent[] = [];

  for (const s of sales) {
    const who = s.cashier?.name;
    if (s.status === "Voided") {
      events.push({
        id: s.id,
        kind: "VOID",
        date: s.createdAt,
        amount: 0,
        label: saleRef(s.id),
        detail: `Voided${who ? ` by ${who}` : ""} — no longer owed`,
      });
      continue;
    }
    events.push({
      id: s.id,
      kind: "CHARGE",
      date: s.createdAt,
      amount: s.totalAmount,
      label: saleRef(s.id),
      detail: who ? `On account by ${who}` : "On account",
    });
  }

  for (const r of refunds) {
    events.push({
      id: r.id,
      kind: "REFUND",
      date: r.createdAt,
      amount: -r.amount,
      label: `Refund — ${saleRef(r.sale.id)}`,
      detail: r.reason,
    });
  }

  for (const p of payments) {
    events.push({
      id: p.id,
      kind: "PAYMENT",
      date: p.createdAt,
      amount: -p.amount,
      label: `Payment (${p.paymentMethod})`,
      detail: p.notes,
    });
  }

  for (const a of adjustments) {
    events.push({
      id: a.id,
      kind: "ADJUSTMENT",
      date: a.createdAt,
      amount: a.amount,
      label: a.kind === "WRITE_OFF" ? "Debt written off" : "Account adjustment",
      detail: `${a.reason}${a.createdBy ? ` — ${a.createdBy.name}` : ""}`,
    });
  }

  return events;
}