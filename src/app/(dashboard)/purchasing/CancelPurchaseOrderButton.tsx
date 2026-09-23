"use client";

import { useState } from "react";
import { cancelPurchaseOrder } from "./actions";

/**
 * "Cancel order" button — drives DRAFT/ORDERED → CANCELLED.
 *
 * Cancellation is Phase 1's only terminal transition, and it is deliberately
 * stock-neutral: `cancelPurchaseOrder` writes nothing but `status`. Nothing is
 * un-ordered in inventory because nothing was ever ordered into inventory yet.
 *
 * Same calling convention as `OrderPurchaseOrderButton`: await the Server
 * Action from a submit handler, let `revalidatePath` refresh the page, keep
 * only pending/error state locally. The confirm gate is mandatory here — the
 * status change is irreversible from the UI.
 */
export default function CancelPurchaseOrderButton({
  id,
  poNumber,
}: {
  id: string;
  poNumber: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !window.confirm(
        `Cancel ${poNumber}? This cannot be undone. Stock is not affected.`,
      )
    ) {
      return;
    }
    const formData = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const result = await cancelPurchaseOrder(formData);
    setPending(false);
    if (!result.ok) setError(result.error ?? "Could not cancel this purchase order.");
  }

  return (
    <form onSubmit={onSubmit} className="inline-block">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3.5 py-2 text-sm font-medium text-red-400 hover:bg-slate-950 disabled:opacity-50"
      >
        {pending ? "Cancelling…" : "Cancel order"}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
