"use client";

import { Printer } from "lucide-react";

/**
 * Reprint button for `/my-transactions/[id]`.
 *
 * A client island for one reason: `window.print()` only exists in the browser.
 * It is the same `window.print()` the POS sale-completion modal calls, and it
 * works because the global `@media print` rules in `globals.css` hide `body *`
 * and expose only `.print-receipt` — so printing here emits the receipt and
 * nothing else, with no print stylesheet to add or maintain.
 */
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500"
    >
      <Printer className="h-3.5 w-3.5" />
      Reprint receipt
    </button>
  );
}