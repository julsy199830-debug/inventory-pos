"use client";

import { useState } from "react";
import { deleteProduct, type DeleteProductResult } from "./actions";

/**
 * Per-row trash button that deletes a product by ID.
 *
 * Drives the {@link deleteProduct} Server Action through a manual async
 * `onSubmit` handler rather than the `<form action={...}>` prop. The confirm
 * gate needs client JS, so this is a Client Component: we intercept `onSubmit`
 * to confirm; cancelling the event stops the call before it ever fires. We
 * `await` the action ourselves and act on its `{ ok, ... }` result — on success
 * `revalidatePath` swaps the page and the row vanishes on its own (no local
 * pending state to clear), and on a failure (e.g. a `SaleItem`/`TransactionItem`
 * FK Restrict, surfaced leak-free by the action) we render the message inline
 * under the button rather than silently rejecting to the nearest error boundary.
 *
 * Calling the action ourselves (vs. `<form action>`) also sidesteps the typing
 * wrinkle where a server action returning a non-void {@link DeleteProductResult}
 * isn't assignable to the `action` prop's `void`-returning signature.
 */
export default function DeleteProductButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!window.confirm(`Delete "${name}"?`)) {
      return;
    }
    setPending(true);
    const fd = new FormData();
    fd.set("id", id);
    const result: DeleteProductResult = await deleteProduct(fd);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? null);
    }
    // On success the action revalidates /inventory, so the row vanishes on its
    // own — no local state to clear beyond the error.
  }

  return (
    <form onSubmit={onSubmit} className="inline-block">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Delete ${name}`}
        title={error ?? `Delete ${name}`}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
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
            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .567c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0C10.39 2.5 9.48 3.484 9.48 4.664v.916m7.5 0a48.523 48.523 0 0 0-7.5 0"
          />
        </svg>
      </button>
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
    </form>
  );
}
