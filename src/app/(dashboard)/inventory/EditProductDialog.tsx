"use client";

import { useRef, useState } from "react";
import { updateProduct, type UpdateProductResult } from "./actions";
import type { CategoryOption } from "./AddProductDialog";

/**
 * Modal for editing an existing product.
 *
 * Mirrors `AddProductDialog` but is bound to one row: it takes the product's
 * current fields as props, prefills them as `defaultValue`s, and posts a
 * hidden `id` alongside the edited fields to the `updateProduct` Server Action.
 *
 * Like the Add dialog, the form submits via a manual async handler (`onSubmit`)
 * that `await`s `updateProduct(formData)` directly — the hidden `id` travels in
 * the `FormData` just like the edited fields. Server Actions are async functions
 * that resolve to their declared return type, so awaiting one gives us the
 * result in the same tick: we close on success and surface validation errors
 * inline, no effect needed. (This is the "Event Handlers" calling convention
 * from the mutating-data docs.)
 *
 * We deliberately don't use `useActionState` here. Its `(state, action, pending)`
 * triple is built for `<form action={...}>` wiring, and the idiomatic way to
 * react to its success is `setState` inside an effect keyed on `state` — which
 * `react-hooks/set-state-in-effect` flags as a derived-state cascade. Calling the
 * action ourselves sidesteps that entirely: the close lives in the submit
 * handler, where side effects belong, not in a render-following effect.
 *
 * `defaultValue` (not `value`) is deliberate: the inputs are uncontrolled, so
 * they stay editable while `pending` only disables them, and they reflect the
 * product as it was when the modal opened (a revalidate mid-edit won't fight
 * the user's typing).
 */

/** Shape of the product fields passed in for prefilling. */
export type EditableProduct = {
  id: string;
  name: string;
  sku: string;
  /** Display name of the product's category, or null when uncategorized. Used
   * only for the table's Category column; the form itself binds to `categoryId`. */
  categoryName: string | null;
  /** The product's current category id, or null when uncategorized. Prefills
   * the managed `<select>`; the dialog posts it back as `categoryId`. */
  categoryId: string | null;
  /** Numeric string of the current retail price, e.g. "199.99". */
  price: string;
  /** Numeric string of the current cost, e.g. "112.00". */
  cost: string;
  /** Numeric string of the current stock, e.g. "34". */
  stock: string;
};

export default function EditProductDialog({
  product,
  categories,
}: {
  product: EditableProduct;
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  // We drive `pending`/`error` ourselves from the awaited action result rather
  // than reading them out of `useActionState` — same UX (inputs + buttons lock
  // while submitting, error renders inline), but no setState-in-effect.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref onto the form so we can reset it once the update succeeds — drops any
  // half-typed edits back to the prefilled values before the next open.
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const result: UpdateProductResult = await updateProduct(formData);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      formRef.current?.reset();
      return;
    }
    setError(result.error ?? null);
  }

  function onClose() {
    if (pending) return; // don't dismiss mid-submit
    setOpen(false);
  }

  return (
    <>
      {/* Trigger — small pencil button rendered inline in the row's Actions cell */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${product.name}`}
        title={`Edit ${product.name}`}
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
            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
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
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                Edit Product
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
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

            <form onSubmit={onSubmit} ref={formRef} className="space-y-4 px-5 py-5">
              {/* Hidden id targets the row to update. */}
              <input type="hidden" name="id" value={product.id} />

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </p>
              )}

              <Field label="Product name" htmlFor="name" required>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  disabled={pending}
                  defaultValue={product.name}
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="SKU" htmlFor="sku" required>
                  <input
                    id="sku"
                    name="sku"
                    type="text"
                    required
                    disabled={pending}
                    defaultValue={product.sku}
                    className={`${inputCls} font-mono`}
                  />
                </Field>
                <Field label="Category" htmlFor="categoryId">
                  <select
                    id="categoryId"
                    name="categoryId"
                    disabled={pending}
                    defaultValue={product.categoryId ?? ""}
                    className={inputCls}
                  >
                    {/* value="" is the "Uncategorized" sentinel the server
                        coerces to null. Prefilled from product.categoryId, so a
                        product whose category was deleted mid-edit (now null)
                        lands here as Uncategorized rather than a phantom option. */}
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Retail price (PHP)" htmlFor="price" required>
                  <input
                    id="price"
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    required
                    disabled={pending}
                    defaultValue={product.price}
                    className={inputCls}
                  />
                </Field>
                <Field label="Cost price (PHP)" htmlFor="cost" required>
                  <input
                    id="cost"
                    name="cost"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    required
                    disabled={pending}
                    defaultValue={product.cost}
                    className={inputCls}
                  />
                </Field>
                <Field label="Stock" htmlFor="stock" required>
                  <input
                    id="stock"
                    name="stock"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    required
                    disabled={pending}
                    defaultValue={product.stock}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="inline-flex items-center rounded-xl border border-slate-200/80 bg-white shadow-sm px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-200/80 bg-white shadow-sm px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/10 disabled:bg-slate-50";

/** Labeled field wrapper — keeps the form DRY. */
function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
