"use client";

import { useRef, useState } from "react";
import { createProduct, type CreateProductResult } from "./actions";

/** One selectable option in the category dropdown. The empty-string id is the
 * "Uncategorized" sentinel the server accepts (it coerces `""`/absent to null). */
export type CategoryOption = { id: string; name: string };

/**
 * Modal dialog for creating a new product.
 *
 * The dialog mounts its own modal overlay once `open` is set, then submits via a
 * manual async handler that `await`s the raw `createProduct` Server Action
 * directly. Server Actions are async functions that resolve to their declared
 * return type, so awaiting one gives us the result in the same tick — we close +
 * reset the form right there on success, no effect needed. (This is the
 * "Event Handlers" calling convention from the mutating-data docs.)
 *
 * We deliberately don't use `useActionState` here. Its `(state, action, pending)`
 * triple is built for `<form action={...}>` wiring, and the idiomatic way to
 * react to its success is `setState` inside an effect keyed on `state` — which
 * `react-hooks/set-state-in-effect` flags as a derived-state cascade. Calling the
 * action ourselves sidesteps that entirely: the close/reset lives in the submit
 * handler, where side effects belong, not in a render-following effect.
 *
 * Note on progressive enhancement: the modal itself is gated behind `{open && …}`,
 * so a JS-disabled client can never reach the form to submit it. `<form action>`
 * would therefore buy nothing real here, and a manual JS submit is the honest
 * shape. Self-contained client island that owns the trigger + modal together so
 * the parent page stays a pure Server Component — the same structure as the
 * suppliers `AddSupplierDialog`.
 *
 * Category is chosen from a managed `<select>` populated server-side (the page
 * passes the current set of {@link CategoryOption}s), so a product is always
 * linked to a real {@link Category} id or left uncategorized — the old free-text
 * `category` field is gone. The field is named `categoryId` to match what
 * {@link createProduct} reads; an empty value means "uncategorized" and is a
 * legal, intentional choice.
 */
export default function AddProductDialog({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  // We drive `pending`/`error` ourselves from the awaited action result rather
  // than reading them out of `useActionState` — same UX (inputs + buttons lock
  // while submitting, error renders inline), but no setState-in-effect.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref onto the form so we can reset it once the insert succeeds — the next
  // time the dialog opens it's a blank form rather than the just-submitted row.
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const result: CreateProductResult = await createProduct(formData);
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
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        <svg
          className="h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        Add New Product
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
                Add New Product
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
                  placeholder="e.g. Aurora Wireless Headphones"
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
                    placeholder="e.g. ELEC-0004"
                    className={`${inputCls} font-mono`}
                  />
                </Field>
                <Field label="Category" htmlFor="categoryId">
                  <select
                    id="categoryId"
                    name="categoryId"
                    disabled={pending}
                    defaultValue=""
                    className={inputCls}
                  >
                    {/* value="" is the "Uncategorized" sentinel the server
                        coerces to null; kept first so it reads as the default. */}
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
                    placeholder="0.00"
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
                    placeholder="0.00"
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
                    placeholder="0"
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
                  {pending ? "Saving…" : "Save product"}
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
