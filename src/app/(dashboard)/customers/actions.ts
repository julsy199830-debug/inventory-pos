"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  NoCashierError,
  getCashier,
  requireCashierSession,
  roleGuardError,
} from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import type { MutationResult } from "@/lib/types";
import { isRevenueSale, round2 } from "@/lib/analytics"; import { buildLedger, type LedgerEntryKind } from "@/lib/ledger"; import { loadLedgerEvents } from "@/lib/ledger-data";

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  creditLimit: number;
  currentBalance: number;
  salesCount: number;
  paymentsCount: number;
  /** Phase 4: free points on the account, read straight off the row. */
  loyaltyPoints: number;
  /** Phase 4: lifetime net spend across this customer's sales. */
  totalSpent: number;
  /** Phase 4: ISO timestamp of the most recent sale, or null. */
  lastSaleAt: string | null;
};

export type CustomerInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  creditLimit?: number;
  notes?: string | null;
};

export type CustomerPaymentInput = {
  customerId: string;
  amount: number;
  paymentMethod: string;
  notes?: string | null;
};

/** Date window for a statement. Both bounds optional; a null bound is unbounded. */
export type StatementFilters = {
  from?: Date | null;
  to?: Date | null;
};

export type AccountAdjustmentInput = {
  customerId: string;
  /** Signed: positive raises what the customer owes, positive-negative lowers it. */
  amount: number;
  kind?: "ADJUSTMENT" | "WRITE_OFF";
  reason: string;
};

export type LoyaltyAdjustmentInput = {
  customerId: string;
  /** Signed point movement. */
  delta: number;
  reason: string;
};

/**
 * Phase 6: a statement row is now a real ledger movement, not "a sale".
 *
 * The pre-Phase-6 version listed EVERY sale for a customer — including cash and
 * card sales that never touched their account — so the statement implied debt
 * the customer did not owe. Rows now carry the movement `kind`, its signed
 * effect on the balance, and the running balance after it.
 */
export type StatementEntry = {
  id: string;
  kind: LedgerEntryKind;
  date: Date;
  /** Signed effect on the outstanding balance. */
  amount: number;
  label: string;
  detail: string | null;
  /** Balance owed immediately after this entry. */
  balance: number;
};

export type CustomerStatement = {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    creditLimit: number;
    currentBalance: number;
    loyaltyPoints: number;
    notes: string | null;
    createdAt: Date;
  };
  entries: StatementEntry[];
  /** Derived from the records, not read from the stored column. */
  balance: number;
  openingBalance: number;
  totalCharges: number;
  totalPayments: number;
};

const STAFF_ROLES = ["ADMIN", "MANAGER"] as const;

type Actor = { ok: false; error: string } | { ok: true; actor: { id: string; name: string } };

async function requireActor(): Promise<Actor> {
  try {
    const actor = await requireCashierSession();
    // `name` rides along so an audit entry written by a caller of this helper
    // can snapshot the actor's display name, not just their id.
    return { ok: true, actor: { id: actor.id, name: actor.name } };
  } catch (err) {
    if (err instanceof NoCashierError) {
      return { ok: false, error: "Sign in to continue." };
    }
    throw err;
  }
}

export async function getCustomers(query?: string) {
  const actor = await requireActor();
  if (!actor.ok) return actor;

  const q = query?.trim();
  const where = q
    ? {
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
        ],
      }
    : undefined;

  const customers = await prisma.customer.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      loyaltyPoints: true,
      creditLimit: true,
      currentBalance: true,
      _count: { select: { sales: true, payments: true } },
      // Phase 4: lifetime spend and last-seen for the list. Aggregate here in one
      // query rather than per-row, and read only stored columns - no total is
      // recomputed in the client, so this cannot disagree with the ledger.
      sales: {
        select: { totalAmount: true, createdAt: true, status: true },
      },
    },
  });

  const rows: CustomerRow[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    creditLimit: c.creditLimit,
    currentBalance: c.currentBalance,
    salesCount: c._count.sales,
    paymentsCount: c._count.payments,
    loyaltyPoints: c.loyaltyPoints,
    // Only money actually kept counts: a Voided or fully Refunded sale is not
    // spend. isRevenueSale is imported rather than reimplemented so this list
    // uses the SAME rule as the dashboard and reports.
    totalSpent: round2(
      c.sales.reduce((n, s) => (isRevenueSale(s.status) ? n + s.totalAmount : n), 0),
    ),
    lastSaleAt:
      c.sales.reduce<Date | null>((latest, s) => {
        if (!isRevenueSale(s.status)) return latest;
        return !latest || s.createdAt > latest ? s.createdAt : latest;
      }, null)?.toISOString() ?? null,
  }));

  return { ok: true as const, data: rows };
}

export async function createCustomer(
  data: CustomerInput,
): Promise<MutationResult<{ id: string }>> {
  const denied = await roleGuardError(STAFF_ROLES);
  if (denied) return { ok: false, error: denied };

  const name = data.name?.trim() ?? "";
  if (!name) return { ok: false, error: "Customer name is required." };

  const creditLimit = Number(data.creditLimit ?? 0);
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    return { ok: false, error: "Credit limit must be 0 or more." };
  }

  const created = await prisma.customer.create({
    data: {
      name,
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      creditLimit,
      notes: data.notes?.trim() || null,
    },
    select: { id: true },
  });

  revalidatePath("/customers");
  const actor = await getCashier();
  await recordAudit({
    action: "CUSTOMER_CREATE",
    userId: actor?.id ?? null,
    actor: actor?.name ?? null,
    entity: "Customer",
    entityId: created.id,
    summary: `Created customer ${name}`,
    after: { name, phone: data.phone?.trim() || null, creditLimit },
  });
  return { ok: true as const, data: { id: created.id } };
}

export async function updateCustomer(
  id: string,
  data: CustomerInput,
): Promise<MutationResult<null>> {
  const denied = await roleGuardError(STAFF_ROLES);
  if (denied) return { ok: false, error: denied };

  const name = data.name?.trim() ?? "";
  if (!name) return { ok: false, error: "Customer name is required." };

  const creditLimit = Number(data.creditLimit ?? 0);
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    return { ok: false, error: "Credit limit must be 0 or more." };
  }

  const existing = await prisma.customer.findUnique({
    where: { id },
    // Widen the select from `id` only so the audit diff can show what actually
    // changed — a credit-limit or name edit is otherwise invisible after the
    // update overwrites the row.
    select: { id: true, name: true, phone: true, email: true, creditLimit: true, notes: true },
  });
  if (!existing) return { ok: false, error: "Customer not found." };

  await prisma.customer.update({
    where: { id },
    data: {
      name,
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      creditLimit,
      notes: data.notes?.trim() || null,
    },
  });

  revalidatePath("/customers");
  const actor = await getCashier();
  await recordAudit({
    action: "CUSTOMER_UPDATE",
    userId: actor?.id ?? null,
    actor: actor?.name ?? null,
    entity: "Customer",
    entityId: id,
    summary: `Edited customer ${name}`,
    before: {
      name: existing.name,
      phone: existing.phone,
      email: existing.email,
      creditLimit: existing.creditLimit,
      notes: existing.notes,
    },
    after: { name, phone: data.phone?.trim() || null, email: data.email?.trim() || null, creditLimit, notes: data.notes?.trim() || null },
  });
  return { ok: true as const, data: null };
}

export async function recordCustomerPayment(
  input: CustomerPaymentInput,
): Promise<MutationResult<{ id: string }>> {
  const actor = await requireActor();
  if (!actor.ok) return actor;

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Payment amount must be greater than 0." };
  }
  const paymentMethod = (input.paymentMethod ?? "").trim();
  if (!paymentMethod) {
    return { ok: false, error: "Payment method is required." };
  }

  // Hoisted out of the transaction so the post-commit audit entry can report the
  // amount actually applied (which is clamped to the outstanding balance, and so
  // can legitimately differ from what was requested).
  let applied = 0;
  try {
    const payment = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { id: true, currentBalance: true },
      });
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
      if (customer.currentBalance <= 0) throw new Error("NO_BALANCE");

      applied = Math.min(amount, customer.currentBalance);

      await tx.customer.update({
        where: { id: customer.id },
        data: { currentBalance: { decrement: applied } },
      });

      return tx.customerPayment.create({
        data: {
          customerId: customer.id,
          amount: applied,
          paymentMethod,
          cashierId: actor.actor.id,
          notes: input.notes?.trim() || null,
        },
        select: { id: true },
      });
    });

    revalidatePath("/customers");
    // Money in against a customer account. `CustomerPayment` already records the
    // amount/method/cashier, so this entry's job is the why (the note) plus the
    // resulting balance — the question an administrator actually asks.
    await recordAudit({
      action: "CUSTOMER_PAYMENT",
      userId: actor.actor.id,
      actor: actor.actor.name,
      entity: "Customer",
      entityId: input.customerId,
      summary: `Recorded a customer payment`,
      after: {
        amount: input.amount,
        applied,
        method: paymentMethod,
        notes: input.notes?.trim() || null,
      },
    });
    return { ok: true as const, data: { id: payment.id } };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "CUSTOMER_NOT_FOUND") {
        return { ok: false, error: "Customer not found." };
      }
      if (err.message === "NO_BALANCE") {
        return { ok: false, error: "This customer has no outstanding balance." };
      }
    }
    return { ok: false, error: "Could not record the payment. Please try again." };
  }
}

export async function getCustomerStatement(
  id: string,
  filters?: StatementFilters,
): Promise<{ ok: true; data: CustomerStatement } | { ok: false; error: string }> {
  const actor = await requireActor();
  if (!actor.ok) return actor;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      creditLimit: true,
      currentBalance: true,
      loyaltyPoints: true,
      notes: true,
      createdAt: true,
    },
  });
  if (!customer) return { ok: false, error: "Customer not found." };

  // The balance is REBUILT from the records, never read from
  // `currentBalance`. That column stays as a cache updated inside the same
  // transactions that write the records; this function is the audit that proves
  // the two agree, and it is what the statement prints.
  const events = await loadLedgerEvents(id);
  const result = buildLedger(events, {
    from: filters?.from ?? null,
    to: filters?.to ?? null,
  });

  const entries: StatementEntry[] = result.entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    date: e.date,
    amount: e.amount,
    label: e.label,
    detail: e.detail ?? null,
    balance: e.balance,
  }));

  return {
    ok: true as const,
    data: {
      customer,
      entries,
      balance: result.balance,
      openingBalance: result.openingBalance,
      totalCharges: result.totalCharges,
      totalPayments: result.totalPayments,
    },
  };
}

/**
 * Phase 6 — a manager-entered correction to a customer's outstanding balance.
 *
 * This writes an `AccountAdjustment` row AND moves `currentBalance` in the same
 * transaction. The row is why the balance is correct; the column is only a cache
 * of it. Moving the column without the row would leave a balance no statement
 * could justify, which is exactly what "auditable" rules out.
 *
 * Manager-only, with a mandatory reason: an unexplained movement of a customer's
 * debt is not something the store should be able to do quietly.
 */
export async function recordAccountAdjustment(
  input: AccountAdjustmentInput,
): Promise<MutationResult<{ id: string; balance: number }>> {
  const denied = await roleGuardError(STAFF_ROLES);
  if (denied) return { ok: false, error: denied };

  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, error: "Adjustment must not be zero." };
  }
  const reason = input.reason?.trim();
  if (!reason) {
    return { ok: false, error: "A reason is required for an account adjustment." };
  }
  const kind = input.kind === "WRITE_OFF" ? "WRITE_OFF" : "ADJUSTMENT";

  const actor = await getCashier();
  try {
    const out = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { id: true, currentBalance: true },
      });
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      // The same "never negative" clamp the ledger applies, so a write-off
      // larger than the debt settles it instead of creating a credit.
      const applied =
        amount < 0
          ? -round2(Math.min(Math.abs(amount), customer.currentBalance))
          : amount;

      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { currentBalance: { increment: applied } },
      });
      const row = await tx.accountAdjustment.create({
        data: {
          customerId: customer.id,
          amount: applied,
          kind,
          reason,
          createdById: actor?.id ?? null,
        },
        select: { id: true },
      });
      return { id: row.id, balance: updated.currentBalance };
    });

    revalidatePath("/customers");
    await recordAudit({
      action: "CUSTOMER_ADJUSTMENT",
      userId: actor?.id ?? null,
      actor: actor?.name ?? null,
      entity: "Customer",
      entityId: input.customerId,
      summary:
        kind === "WRITE_OFF"
          ? `Wrote off customer balance by ${amount}`
          : `Adjusted customer balance by ${amount}`,
      after: { amount, kind, reason, balance: out.balance },
    });
    return { ok: true as const, data: out };
  } catch (err) {
    if (err instanceof Error && err.message === "CUSTOMER_NOT_FOUND") {
      return { ok: false, error: "Customer not found." };
    }
    return {
      ok: false,
      error: "Could not record the adjustment. Please try again.",
    };
  }
}

/**
 * Phase 6 — a manager-entered loyalty points correction.
 *
 * Mirrors {@link recordAccountAdjustment}: the `LoyaltyEvent` row is the record,
 * `Customer.loyaltyPoints` is the cache. Same rule, same mandatory reason.
 */
export async function recordLoyaltyAdjustment(
  input: LoyaltyAdjustmentInput,
): Promise<MutationResult<{ id: string; points: number }>> {
  const denied = await roleGuardError(STAFF_ROLES);
  if (denied) return { ok: false, error: denied };

  const delta = Math.trunc(Number(input.delta));
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, error: "Points adjustment must not be zero." };
  }
  const reason = input.reason?.trim();
  if (!reason) {
    return { ok: false, error: "A reason is required for a points adjustment." };
  }

  const actor = await getCashier();
  try {
    const out = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { id: true, loyaltyPoints: true },
      });
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
      if (customer.loyaltyPoints + delta < 0) throw new Error("POINTS_CONFLICT");

      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { loyaltyPoints: { increment: delta } },
      });
      const row = await tx.loyaltyEvent.create({
        data: {
          customerId: customer.id,
          delta,
          kind: "ADJUSTED",
          reason,
          createdById: actor?.id ?? null,
        },
        select: { id: true },
      });
      return { id: row.id, points: updated.loyaltyPoints };
    });

    revalidatePath("/customers");
    await recordAudit({
      action: "LOYALTY_ADJUST",
      userId: actor?.id ?? null,
      actor: actor?.name ?? null,
      entity: "Customer",
      entityId: input.customerId,
      summary: `Adjusted loyalty points by ${delta}`,
      after: { delta, reason, points: out.points },
    });
    return { ok: true as const, data: out };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "CUSTOMER_NOT_FOUND") {
        return { ok: false, error: "Customer not found." };
      }
      if (err.message === "POINTS_CONFLICT") {
        return { ok: false, error: "That would take the points below zero." };
      }
    }
    return {
      ok: false,
      error: "Could not record the adjustment. Please try again.",
    };
  }
}
