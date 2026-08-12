"use client";

import { useRef, useState } from "react";
import { createCategory, type CategoryResult } from "../actions";

/**
 * Modal dialog for creating a new category.
 *
 * Mirrors the inventory/suppliers `Add<…>Dialog` shells: a self-contained
 * client island that owns its trigger + modal, submits via a manual async
 * handler that `await`s the raw {@link createCategory} Server Action directly
 * (the "Event Handlers" convention), and closes + resets the form on success.
 * We deliberately don't use `useActionState` — reacting to its success would
 * mean `setState` inside an effect keyed on state, which the
 * `react-hooks/set-state-in-effect` lint flags as a derived-state cascade; calling
 * the action ourselves lets the close/reset live in the submit handler, where
 * side effects belong.
 *
 * `name` is `@unique` on `Category`, so a duplicate is caught server-side (P2002)
 * and surfaced inline here. On success the action revalidates `/inventory/categories`
 * (this table) and `/inventory` (the product-form dropdown + filter depend on the
 * category set), so both pages stream the new row on the next render.
 */
export default function AddCategoryDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const result: CategoryResult = await createCategory(formData);
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
        Add Category
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                Add Category
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

              <Field label="Category name" htmlFor="name" required>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  disabled={pending}
                  placeholder="e.g. Electronics"
                  className={inputCls}
                />
              </Field>

              <p className="text-xs text-slate-500">
                A new category starts with the default low-stock threshold (10). Tune it per-category from the row once it exists.
              </p>

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
                  {pending ? "Saving…" : "Add category"}
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

/** Labeled field wrapper — keeps the form DRY (matches the sibling dialogs). */
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
