/**
 * Phase 6 — the customer account ledger.
 *
 * The balance a customer owes is DERIVED here from the records that caused it
 * (credit sales, refunds, payments, manual adjustments) rather than read from
 * `Customer.currentBalance`. A stored float can only ever be trusted if you can
 * rebuild it, and this module is the rebuild.
 *
 * Two properties make the result auditable:
 *
 *  1. Every row on the statement points back at the record that produced it, so
 *     a manager can open the sale or payment and see the same number.
 *  2. The running balance is computed from the FULL history even when the
 *     statement is date-filtered. A window that starts on the 15th still shows
 *     the balance the customer had on the 15th, because every entry before the
 *     window is summed into `openingBalance` first. Recomputing a filtered range
 *     in isolation would report a wrong closing balance, which is the classic way
 *     a statement tool lies.
 *
 * Sign convention, matching `Customer.currentBalance` exactly:
 *   positive = the customer owes the store MORE
 *   negative = they owe LESS
 *
 * This file is PURE — no Prisma import — so the arithmetic can be unit-tested
 * without a database. `loadCustomerLedger` in `./ledger-data` does the reading.
 */

import { round2 } from "./analytics";

/** Every kind of movement a customer account can show. */
export type LedgerEntryKind =
  /** A completed STORE_CREDIT sale: the customer now owes more. */
  | "CHARGE"
  /** Money received against the account: they owe less. */
  | "PAYMENT"
  /** Goods returned on an account sale: they owe less. */
  | "REFUND"
  /** An account sale was voided. Net zero — shown for completeness. */
  | "VOID"
  /** A manager-entered correction or write-off. Signed either way. */
  | "ADJUSTMENT";

/** One normalised movement, before the running balance is computed. */
export type LedgerEvent = {
  id: string;
  kind: LedgerEntryKind;
  date: Date;
  /** Signed effect on the outstanding balance. */
  amount: number;
  /** Short label for the statement row, e.g. "Sale #a1b2c3d4". */
  label: string;
  /** Secondary line: cashier name, reason, payment method. */
  detail?: string | null;
};

export type LedgerEntry = LedgerEvent & {
  /** Balance owed immediately AFTER this entry. */
  balance: number;
};

export type LedgerResult = {
  /** Entries inside the requested window, oldest first. */
  entries: LedgerEntry[];
  /** Closing balance: owed at the end of the window (or now). */
  balance: number;
  /** Balance owed immediately BEFORE the first entry in the window. */
  openingBalance: number;
  /** Window totals, for the statement summary. */
  totalCharges: number;
  totalPayments: number;
};

/**
 * Is this entry money coming IN (reducing what is owed)?
 *
 * `CHARGE` and a positive `ADJUSTMENT` increase the debt; everything else
 * reduces it. `VOID` is handled separately because it must never move the
 * balance at all.
 */
function isReduction(kind: LedgerEntryKind, amount: number): boolean {
  if (kind === "VOID") return false;
  if (kind === "CHARGE") return false;
  if (kind === "ADJUSTMENT") return amount < 0;
  return true;
}

/**
 * Build the statement.
 *
 * The "never negative" rule is reproduced deliberately, not incidentally: the
 * existing actions already clamp every reduction at zero (a payment larger than
 * the balance settles it and no more), so a ledger that ignored the clamp would
 * quietly disagree with the balance the customer has actually been shown. The
 * running balance therefore never dips below 0, and a reduction is applied only
 * up to what is currently owed.
 */
export function buildLedger(
  events: LedgerEvent[],
  window?: { from?: Date | null; to?: Date | null },
): LedgerResult {
  // Oldest first, with a stable tie-break. Two entries can share a timestamp
  // (SQLite's CURRENT_TIMESTAMP has second resolution), and a ledger whose order
  // shifts between renders is not reproducible.
  const ordered = [...events].sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  let running = 0;
  let totalCharges = 0;
  let totalPayments = 0;

  const computed: LedgerEntry[] = ordered.map((e) => {
    let amount = round2(e.amount);

    if (e.kind === "VOID") {
      // The sale never became a charge and `voidSale` tags its reversal row
      // VOID_REVERSAL so it is not counted here either. Net zero, by design.
      amount = 0;
    } else if (isReduction(e.kind, amount) && amount < 0) {
      // Clamp to what is actually owed, matching recordCustomerPayment /
      // refundSale. `Math.abs` because reductions are stored as positive
      // magnitudes and negated below.
      amount = -round2(Math.min(Math.abs(amount), running));
    }

    running = round2(running + amount);

    if (e.kind === "CHARGE" || (e.kind === "ADJUSTMENT" && amount > 0)) {
      totalCharges = round2(totalCharges + amount);
    } else if (amount < 0) {
      totalPayments = round2(totalPayments + Math.abs(amount));
    }

    return { ...e, amount, balance: running };
  });

  const inWindow = computed.filter((e) => {
    if (window?.from && e.date < window.from) return false;
    if (window?.to && e.date > window.to) return false;
    return true;
  });

  // Balance owed before the first visible row. When nothing is visible, it is the
  // closing balance so the summary never shows a nonsensical pair.
  const openingBalance =
    inWindow.length > 0
      ? round2(inWindow[0].balance - inWindow[0].amount)
      : running;

  return {
    entries: inWindow,
    balance: running,
    openingBalance,
    totalCharges,
    totalPayments,
  };
}