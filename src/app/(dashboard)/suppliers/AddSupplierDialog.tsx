"use client";

import { useRef, useState } from "react";
import { createSupplier, type CreateSupplierResult } from "./actions";

/**
 * Modal dialog for creating a new supplier.
 *
 * The dialog mounts its own modal overlay once `open` is set, then submits via a
 * manual async handler that `await`s the raw `createSupplier` Server Action
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
 * inventory `AddProductDialog`.
 */
export default function AddSupplierDialog() {
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
    const result: CreateSupplierResult = await createSupplier(formData);
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
        Add New Supplier
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
                Add New Supplier
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

              <Field label="Supplier name" htmlFor="name" required>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  disabled={pending}
                  placeholder="e.g. Acme Distribution Co."
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Contact name" htmlFor="contactName">
                  <input
                    id="contactName"
                    name="contactName"
                    type="text"
                    disabled={pending}
                    placeholder="e.g. Jordan Rivera"
                    className={inputCls}
                  />
                </Field>
                <Field label="Email" htmlFor="email">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    disabled={pending}
                    placeholder="e.g. orders@acme.co"
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Phone" htmlFor="phone">
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    disabled={pending}
                    placeholder="e.g. +1 555 0100"
                    className={inputCls}
                  />
                </Field>
                <Field label="Address" htmlFor="address">
                  <input
                    id="address"
                    name="address"
                    type="text"
                    disabled={pending}
                    placeholder="e.g. 100 Warehouse Rd, NV 89101"
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
                  {pending ? "Saving…" : "Save supplier"}
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
