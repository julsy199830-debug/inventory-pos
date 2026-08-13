"use client";

import { useState } from "react";
import { getStockMovements, type StockMovementView } from "./actions";
import type { StockMovementType } from "@/lib/types";

/**
 * Modal for viewing one product's stock-movement audit trail.
 *
 * Mirrors `EditProductDialog`'s trigger + modal scaffold: a small clock/history
 * icon button rendered inline in the row's Actions cell opens the overlay, and
 * the overlay uses the same fixed/inset/z-50 backdrop treatment, bordered white
 * card, and SVG close button. The zinc palette keeps the dark-theme styling
 * consistent with the rest of the inventory table.
 *
 * Unlike the edit/add dialogs this is a read-only view. History is fetched on
 * open via the `getStockMovements` Server Action — invoked from the open
 * handler (the "Event Handlers" convention), not an effect, so the fetch is a
 * genuine side effect of a user action rather than a render-following cascade.
 * The lazy fetch is deliberate: movements grow without bound for the lifetime
 * of a row, so the page never `include`s them per product — only the one
 * product's recent slice (max 50) loads when the user actually opens history.
 *
 * While loading, an animated skeleton is shown. Once loaded, each movement
 * renders as a row with a type badge (color-coded by movement kind), a signed
 * quantity (+N green / −N red), a formatted timestamp, and the optional
 * reason/notes.
 */
export default function StockHistoryDialog({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movements, setMovements] = useState<StockMovementView[]>([]);

  // Fetch on open, in the click handler (the codebase's "Event Handlers"
  // convention — see the docblock on `getStockMovements` in actions.ts). Each
  // open refetches so the modal always shows the freshest audit slice; the
  // previous list is cleared first so a stale list never lingers under the
  // skeleton.
  async function onOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setMovements([]);
    const result = await getStockMovements(productId);
    if (result.ok) {
      setMovements(result.data.movements);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  function onClose() {
    if (loading) return; // don't dismiss mid-fetch
    setOpen(false);
  }

  return (
    <>
      {/* Trigger — small clock/history icon button in the row's Actions cell */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Stock history for ${productName}`}
        title={`Stock history for ${productName}`}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <svg
          className="h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900">
                  Stock History
                </h2>
                <p className="mt-0.5 max-w-sm truncate text-sm text-slate-500">
                  {productName}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                aria-label="Close"
              >
                <svg
                  className="h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.8}
                  stroke="currentColor"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 6l12 12M18 6L6 18"
                  />
                </svg>
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto px-5 py-5">
              {loading ? (
                <LoadingSkeleton />
              ) : error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </p>
              ) : movements.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  No stock movements recorded for this product yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {movements.map((movement) => (
                    <MovementRow key={movement.id} movement={movement} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Movement row & helpers ──────────────────────────────────────────────────

/**
 * Badge treatment by movement type. RESTOCK (stock arriving, including the
 * opening "Initial stock" row) is green; SALE (stock leaving) is red;
 * ADJUSTMENT (manual +/- edits, the catch-all bucket) is amber; DAMAGE
 * (write-offs) is orange. Mirrors the `StockMovementType` union in
 * `@/lib/types`, which is the narrowed type the server ships.
 */
const TYPE_STYLES: Record<StockMovementType, string> = {
  RESTOCK: "bg-blue-100 text-blue-700 border-blue-200",
  SALE: "bg-red-100 text-red-700 border-red-200",
  ADJUSTMENT: "bg-amber-100 text-amber-700 border-amber-200",
  DAMAGE: "bg-orange-100 text-orange-700 border-orange-200",
};

/** One movement: type badge + signed quantity on top, timestamp + note below. */
function MovementRow({ movement }: { movement: StockMovementView }) {
  return (
    <li className="rounded-lg border border-slate-200/80 p-4">
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TYPE_STYLES[movement.type]}`}
        >
          {movement.type}
        </span>
        <span
          className={`text-sm font-semibold tabular-nums ${quantityColor(
            movement.quantityChange
          )}`}
        >
          {signedQuantity(movement.quantityChange)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
        <time dateTime={movement.createdAt}>
          {formatTimestamp(movement.createdAt)}
        </time>
        {movement.reason && (
          <span className="truncate" title={movement.reason}>
            {movement.reason}
          </span>
        )}
      </div>
    </li>
  );
}

/** Sign the quantity for display: +10 for increases, −5 for decreases. */
function signedQuantity(quantity: number): string {
  return quantity > 0 ? `+${quantity}` : `${quantity}`;
}

/** Green for increases, red for decreases, neutral gray for a zero delta. */
function quantityColor(quantity: number): string {
  if (quantity > 0) return "text-blue-600";
  if (quantity < 0) return "text-red-600";
  return "text-slate-500";
}

/** Format the ISO timestamp readably, e.g. "Aug 11, 2026, 8:25 AM". */
function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Animated placeholder rows shown while `getStockMovements` is in flight. */
function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-slate-100 p-4"
        >
          <div className="flex items-center justify-between">
            <div className="h-5 w-24 rounded-full bg-slate-200" />
            <div className="h-4 w-10 rounded bg-slate-200" />
          </div>
          <div className="mt-3 h-3 w-2/3 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
