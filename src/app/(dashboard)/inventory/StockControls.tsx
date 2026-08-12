"use client";

import { useState } from "react";
import { toast } from "sonner";
import { adjustStock, type StockAdjustResult } from "./actions";

/**
 * Inline +/- quick-adjust controls for one product row.
 *
 * Calls the {@link adjustStock} Server Action directly with the row id and a
 * signed delta (+1/-1 here — the action enforces the >= 0 floor server-side, so
 * clicking -1 on a 0-stock row surfaces "Stock can't go below zero" rather than
 * corrupting the count). This is the "Event Handlers" calling convention: we
 * `await` the action ourselves and act on its result, no `useActionState`, so
 * there's no setState-in-effect cascade to fight (same shape as the dialogs).
 *
 * On success the action `revalidatePath('/inventory')` swaps the table, so the
 * authoritative stock re-streams in on its own; we additionally mirror the
 * returned `stock` into a local optimistic label so the count updates instantly
 * before the revalidated rows land. Each adjustment also fires a sonner toast
 * (per-row id, so a rapid +/- run updates the same notification in place). On
 * failure we surface the leak-free error message both inline under the buttons
 * and as a toast.
 *
 * `pending` locks the buttons during the in-flight call so a double click can't
 * fan out two competing adjustments (and the transaction inside the action resists
 * the race anyway, but the UI shouldn't invite it).
 */
export default function StockControls({
  id,
  stock,
  name,
}: {
  id: string;
  stock: number;
  name: string;
}) {
  const [displayed, setDisplayed] = useState(stock);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function adjust(delta: number) {
    if (pending) return;
    setPending(true);
    setError(null);
    const result: StockAdjustResult = await adjustStock(id, delta);
    setPending(false);
    if (result.ok) {
      // Optimistically reflect the server-confirmed new stock; the revalidated
      // table will confirm it as soon as the rows stream back in.
      if (result.stock != null) setDisplayed(result.stock);
      // One live toast per row: a stable id means a rapid +/- click run updates
      // the same toast in place instead of stacking a pile of notifications.
      toast.success(`${name} — ${result.stock ?? "?"} in stock`, {
        id: `stock-${id}`,
      });
    } else {
      const message = result.error ?? "Could not update stock.";
      setError(message);
      toast.error(message, { id: `stock-${id}` });
    }
  }

  return (
    <span className="inline-flex items-center gap-0.5" title={error ?? undefined}>
      <button
        type="button"
        onClick={() => adjust(-1)}
        disabled={pending}
        aria-label="Decrease stock by one"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
      >
        <svg
          className="h-3 w-3"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M2.5 6h7" />
        </svg>
      </button>
      {/* Compact numeric readout so the inline control doubles as a stock
          gauge without duplicating the dedicated count pill column. */}
      <span className="min-w-[1.75rem] text-center font-mono text-xs font-medium text-slate-700">
        {displayed}
      </span>
      <button
        type="button"
        onClick={() => adjust(1)}
        disabled={pending}
        aria-label="Increase stock by one"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
      >
        <svg
          className="h-3 w-3"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 2.5v7M2.5 6h7" />
        </svg>
      </button>
      {error && (
        <span role="alert" className="ml-1 text-xs font-medium text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
