"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCashier } from "@/lib/session";
import { clockIn, clockOut, startBreak, endBreak } from "@/app/(dashboard)/employees/actions";
import { createCustomer, type CustomerInput } from "@/app/(dashboard)/customers/actions";

/**
 * POS-owned server actions (Phase 4).
 *
 * The register needs a couple of things the sale flow does not have. They live
 * here rather than in the register component so that:
 *
 *  - every action still carries a `"use server"` boundary, and
 *  - the POS never reaches across route groups from a component. It calls
 *    through this module, which delegates to the action that already owns the
 *    business rule. `createPosCustomer` below is a THIN wrapper: the staff
 *    role gate, the field validation, the audit entry and the row write are all
 *    still the existing `createCustomer`, so there is exactly one create path
 *    for a customer whether it is started at the till or on the Customers page.
 */

/**
 * Creates a customer mid-sale and attaches them to the open cart.
 *
 * Reuses `createCustomer` wholesale rather than re-implementing any part of it.
 * The only additions are the two revalidations a POS caller needs: the Customers
 * list (the row now exists) and `/pos` itself, so a reload sees the new book.
 */
export async function createPosCustomer(
  input: Pick<CustomerInput, "name"> & { phone?: string | null },
) {
  const res = await createCustomer({ name: input.name, phone: input.phone ?? null });
  if (res.ok) {
    revalidatePath("/customers");
    revalidatePath("/pos");
  }
  return res;
}
// ── Register / shift status (Phase 4, section 3) ────────────────────────────
//
// The register could previously not tell a cashier whether they were on the
// clock, or what they had taken so far. The employees page owns clock in/out
// but it is a management screen: its `clockIn`/`clockOut` accept an arbitrary
// `userId` field precisely so a manager can clock a colleague in. That is the
// right shape there and the WRONG shape at a till - a cashier must only ever
// move their OWN shift, so these actions resolve the user from the session and
// never read a userId from the payload.

/** What the till shows in its status strip. */
export type RegisterStatus = {
  onClock: boolean;
  /** ISO start of the open shift, when `onClock`. */
  shiftStartedAt: string | null;
  /**
   * True while the signed-in cashier is ON AN UNPAID BREAK (Phase 5 — DTR).
   * Always false when `onClock` is false: a break only exists inside an open
   * shift. The till uses it to swap the break button and to explain why
   * clock-out is locked (an open break blocks `clockOut` server-side).
   */
  onBreak: boolean;
  /** ISO start of the open break, when `onBreak`. */
  breakStartedAt: string | null;
  cashierName: string;
  /**
   * Sales figures for the OPEN shift only. Null while off the clock: an
   * off-shift till has no window to report over, and zeroing it would read as
   * "you sold nothing" rather than "you are not working".
   */
  live: {
    salesCount: number;
    grossSales: number;
    /** Completed sales grouped by payment method, for the drawer reconciliation. */
    byPayment: { method: string; count: number; total: number }[];
    /** Refunds issued in this window - money out of the drawer. */
    refundCount: number;
    refundTotal: number;
    /** Sales thrown away entirely in this window. */
    voidCount: number;
    voidTotal: number;
  } | null;
};

/**
 * Reads the current cashier's register status and, when they are on the clock,
 * what they have rung up so far.
 *
 * Deliberately mirrors the filter `closeShift` uses when it snapshots a shift -
 * same `cashierId`, same "Completed" status, same [start, now) window - so the
 * live figure a cashier watches grow is the same number that gets written onto
 * the Shift row at clock-out. If the two ever disagreed, the live figure would
 * be a lie that only surfaces days later on a performance report.
 *
 * Refunds and voids are counted separately from the sales total because they
 * are money and stock moving the OTHER way: a drawer that rings up
 * gross-of-refunds looks short.
 */
export async function getRegisterStatus(): Promise<
  { ok: true; data: RegisterStatus } | { ok: false; error: string }
> {
  const me = await getCashier();
  if (!me) return { ok: false, error: "Sign in to continue." };

  const open = await prisma.shift.findFirst({
    where: { userId: me.id, end: null },
    select: { id: true, start: true },
  });

  if (!open) {
    return {
      ok: true,
      data: {
        onClock: false,
        shiftStartedAt: null,
        onBreak: false,
        breakStartedAt: null,
        cashierName: me.name,
        live: null,
      },
    };
  }

  // The open break (if any) is read alongside the shift so the strip renders
  // a coherent snapshot: a break belonging to this shift only.
  const openBreak = await prisma.shiftBreak.findFirst({
    where: { shiftId: open.id, end: null },
    select: { start: true },
  });

  const window = { gte: open.start, lt: new Date() };

  const [agg, grouped, refunds, voids] = await Promise.all([
    prisma.sale.aggregate({
      _sum: { totalAmount: true },
      _count: true,
      where: { cashierId: me.id, status: "Completed", createdAt: window },
    }),
    prisma.sale.groupBy({
      by: ["paymentMethod"],
      _sum: { totalAmount: true },
      _count: true,
      where: { cashierId: me.id, status: "Completed", createdAt: window },
    }),
    prisma.saleRefund.aggregate({
      _sum: { amount: true },
      _count: true,
      where: { cashierId: me.id, createdAt: window },
    }),
    prisma.sale.aggregate({
      _sum: { totalAmount: true },
      _count: true,
      where: { cashierId: me.id, status: "Voided", createdAt: window },
    }),
  ]);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    ok: true,
    data: {
      onClock: true,
      shiftStartedAt: open.start.toISOString(),
      onBreak: openBreak !== null,
      breakStartedAt: openBreak ? openBreak.start.toISOString() : null,
      cashierName: me.name,
      live: {
        salesCount: agg._count,
        grossSales: round2(agg._sum.totalAmount ?? 0),
        byPayment: grouped
          .map((g) => ({
            method: g.paymentMethod,
            count: g._count,
            total: round2(g._sum.totalAmount ?? 0),
          }))
          // Cash first: it is the drawer, and it is the line a cashier has to
          // reconcile before they can leave.
          .sort((a, b) =>
            a.method === "CASH" ? -1 : b.method === "CASH" ? 1 : b.total - a.total,
          ),
        refundCount: refunds._count,
        refundTotal: round2(refunds._sum.amount ?? 0),
        voidCount: voids._count,
        voidTotal: round2(voids._sum.totalAmount ?? 0),
      },
    },
  };
}

/**
 * Clock the SIGNED-IN cashier in, opening a fresh shift.
 *
 * The user comes from the session, never from the payload, so this cannot be
 * used to open a shift for someone else. Reuses the existing `clockIn` for the
 * write so the auto-close of a forgotten prior shift, the Shift row, and the
 * EMPLOYEE_SHIFT_IN audit entry all stay exactly as the employees page produces
 * them.
 */
export async function clockSelfIn() {
  const me = await getCashier();
  if (!me) return { ok: false as const, error: "Sign in to continue." };

  const form = new FormData();
  form.append("userId", me.id);
  const res = await clockIn(form);
  if (res.ok) revalidatePath("/pos");
  return res;
}

/**
 * Clock the SIGNED-IN cashier out, snapshotting the shift.
 *
 * Returns the closed shift's own snapshot so the till can show an end-of-shift
 * summary from the persisted row rather than from the pre-close live figures -
 * the row is the record of what the shift actually was.
 */
export async function clockSelfOut(): Promise<
  | {
      ok: true;
      data: {
        startedAt: string;
        endedAt: string | null;
        totalSales: number;
        salesCount: number;
      };
    }
  | { ok: false; error: string }
> {
  const me = await getCashier();
  if (!me) return { ok: false, error: "Sign in to continue." };

  const open = await prisma.shift.findFirst({
    where: { userId: me.id, end: null },
    select: { id: true, start: true },
  });
  if (!open) {
    return { ok: false, error: "You are not currently on the clock." };
  }

  const form = new FormData();
  form.append("userId", me.id);
  const res = await clockOut(form);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not clock out." };

  const closed = await prisma.shift.findUnique({
    where: { id: open.id },
    select: { start: true, end: true, totalSales: true, salesCount: true },
  });

  revalidatePath("/pos");
  return {
    ok: true,
    data: {
      startedAt: closed?.start.toISOString() ?? open.start.toISOString(),
      endedAt: closed?.end?.toISOString() ?? null,
      totalSales: closed?.totalSales ?? 0,
      salesCount: closed?.salesCount ?? 0,
    },
  };
}

/**
 * Start an unpaid break for the SIGNED-IN cashier (Phase 5 — DTR).
 *
 * Same shape as `clockSelfIn`/`clockSelfOut`: the user comes from the session,
 * never from the payload, and the write goes through the employees-module
 * `startBreak` so the double-open-break rejection, the audit entry and the
 * revalidations stay in exactly one place.
 */
export async function startBreakSelf() {
  const me = await getCashier();
  if (!me) return { ok: false as const, error: "Sign in to continue." };

  const form = new FormData();
  form.append("userId", me.id);
  const res = await startBreak(form);
  if (res.ok) revalidatePath("/pos");
  return res;
}

/**
 * End the SIGNED-IN cashier's open break (Phase 5 — DTR).
 *
 * Idempotent downstream (the employees-module `endBreak` no-ops when nothing
 * is open), so a double tap or a stale button can't produce an error.
 */
export async function endBreakSelf() {
  const me = await getCashier();
  if (!me) return { ok: false as const, error: "Sign in to continue." };

  const form = new FormData();
  form.append("userId", me.id);
  const res = await endBreak(form);
  if (res.ok) revalidatePath("/pos");
  return res;
}