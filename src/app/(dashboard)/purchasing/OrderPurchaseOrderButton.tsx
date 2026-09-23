"use client";

import { useState } from "react";
import { orderPurchaseOrder } from "./actions";

/**
 * "Mark as ordered" button — drives the DRAFT → ORDERED transition.
 *
 * `orderPurchaseOrder` returns a result object (not `Promise<void>`), so it
 * can't be wired straight into `<form action={...}>` the way `deleteSupplier`
 * is. Instead we call it from a submit handler and await the result, matching
 * the `AddSupplierDialog` calling convention: `revalidatePath` inside the
 * action refreshes the Server Component, so no local state tracks the new
 * status — only the transient pending/error state lives here.
 *
 * The confirm gate mirrors `DeleteSupplierButton`: ordering freezes the line
 * items (ORDERED POs only allow notes/expected-date edits), so it deserves a
 * beat of friction.
 */

export default function OrderPurchaseOrderButton({
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
        `Mark ${poNumber} as ordered? Line items can no longer be edited afterwards.`,
      )
    ) {
      return;
    }
    const formData = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const result = await orderPurchaseOrder(formData);
    setPending(false);
    if (!result.ok) setError(result.error ?? "Could not order this purchase order.");
  }

  return (
    <form onSubmit={onSubmit} className="inline-block">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Ordering…" : "Mark as ordered"}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

