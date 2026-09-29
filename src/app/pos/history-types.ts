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
