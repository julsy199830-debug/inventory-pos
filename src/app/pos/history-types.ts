/**
 * Shared shapes + limits for the POS transaction-history panel.
 *
 * Lives outside `history-actions.ts` because a `"use server"` module may only
 * export async functions — constants and types belong in a plain module that
 * both the actions and the client component can import.
 */

/** How many recent transactions the panel loads at a time. */
export const HISTORY_LIMIT = 20;

/** Row shape for the history list — no items, no PII beyond names. */
export type SaleHistoryEntry = {
  id: string;
  createdAt: string; // ISO string
  totalAmount: number;
  paymentMethod: string;
  status: string;
  cashierName: string | null;
  customerName: string | null;
  /** Phase 1d: running refunded total, so the list can flag a part-returned
   *  sale without fetching its items. 0 for an untouched sale. */
  refundedAmount: number;
};

/** Full detail shape loaded only when a sale is selected. */
export type SaleDetailsEntry = SaleHistoryEntry & {
  subtotal: number;
  discountAmount: number;
  tax: number;
  tendered: number | null;
  change: number | null;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  /** Phase 1d: points spent at checkout and the peso value credited. */
  redeemedPoints: number;
  redemptionAmount: number;
  earnedPoints: number;
  /** Phase 1d: running total refunded. 0 for an untouched sale. */
  refundedAmount: number;
  items: {
    id: string;
    productName: string;
    quantity: number;
    /** Units already refunded against this line (Phase 1d). Drives both the
     *  "x of y refunded" display and the max selectable quantity in the
     *  refund dialog. */
    refundedQuantity: number;
    priceAtSale: number;
  }[];
  /** Phase 1d: every refund event against this sale, newest first. Empty for
   *  a sale that has never been refunded. */
  refunds: {
    id: string;
    amount: number;
    reason: string;
    createdAt: string;
    cashierName: string | null;
  }[];
};

/** Time-window presets for the history filter. */
export type HistoryScope = "today" | "recent";

/**
 * Phase 3: the filter set the transaction-history panel can apply.
 *
 * Every field is optional and they compose with AND, so a manager can ask the
 * question they actually have - "card sales by Ana this week that were
 * refunded" - instead of the two the old panel offered.
 *
 * `scope` stays as the coarse time preset because it is what the cashier
 * toggles constantly; `from`/`to` are the explicit alternative when they want a
 * named day. Both are optional and `from`/`to` win when both are supplied.
 */
export type HistoryFilters = {
  /** Free text across sale id, customer name and cashier name. */
  query?: string;
  scope?: HistoryScope;
  /** Inclusive `YYYY-MM-DD` lower bound. */
  from?: string;
  /** Inclusive `YYYY-MM-DD` upper bound. */
  to?: string;
  /** Exact `Sale.status`; e.g. "Completed", "Voided", "Partially Refunded". */
  status?: string;
  /** Exact `Sale.paymentMethod`; e.g. "CASH", "CARD", "STORE_CREDIT". */
  paymentMethod?: string;
  cashierId?: string;
  customerId?: string;
};

/** One option in a history filter dropdown. */
export type HistoryFacet = {
  value: string;
  label: string;
  /** How many sales carry this value, so a manager can see where to look. */
  count: number;
};

/** The distinct cashier / customer / status / payment values present. */
export type HistoryFacets = {
  cashiers: HistoryFacet[];
  customers: HistoryFacet[];
  statuses: HistoryFacet[];
  paymentMethods: HistoryFacet[];
};

/** The sale statuses the history filter offers, in lifecycle order. */
export const HISTORY_STATUSES = [
  "Completed",
  "Partially Refunded",
  "Refunded",
  "Voided",
] as const;

/** The payment methods the history filter offers. Mirrors the POS register. */
export const HISTORY_PAYMENT_METHODS = [
  "CASH",
  "CARD",
  "STORE_CREDIT",
] as const;
