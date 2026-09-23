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
  items: {
    id: string;
    productName: string;
    quantity: number;
    priceAtSale: number;
  }[];
};

/** Time-window presets for the history filter. */
export type HistoryScope = "today" | "recent";
