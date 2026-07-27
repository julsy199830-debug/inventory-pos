"use client";

import { useState } from "react";
import { updateSupplier, type UpdateSupplierResult } from "./actions";

/**
 * Modal dialog for editing an existing supplier.
 *
 * Sibling to `AddSupplierDialog` — same hand-rolled Tailwind modal shell,
 * `Field` wrapper, and `inputCls` — except every field is prefilled with the
 * row's current values (via `defaultValue`). The supplier's `id` travels as a
 * hidden field (the same technique `deleteSupplier` uses).
 *
 * Like `AddSupplierDialog`, we submit via a manual async handler that `await`s
 * the raw `updateSupplier` Server Action directly — `updateSupplier` takes only
 * the `formData` (no `prevState`, since it's invoked from the event handler,
 * not `useActionState`). Server Actions are async functions that resolve to
 * their declared return type, so awaiting one gives us the result in the same
 * tick — we close the dialog right there on success, no effect needed. (This
 * is the "Event Handlers" calling convention from the mutating-data docs.)
 *
 * We deliberately don't use `useActionState` here. Its `(state, action,
 * pending)` triple is built for `<form action={...}>` wiring, and the
 * idiomatic way to react to its success is `setState` inside an effect keyed on
 * `state` — which `react-hooks/set-state-in-effect` flags as a derived-state
 * cascade. Calling the action ourselves sidesteps that entirely: the close
 * lives in the submit handler, where side effects belong, not in a
 * render-following effect.
 *
 * On success we `revalidatePath('/suppliers')` on the server, so the dialog
 * just auto-closes and the edited row streams back in.
 *
 * The `supplier` prop carries the raw, nullable DB values (`string | null`).
 * The em-dash you see in the suppliers table is a pure display concern rendered
 * in `page.tsx` — the dialog never sees "—" — so it coalesces `null → ""` here
 * at the input layer (`defaultValue={supplier.email ?? ""}`), where empty
 * fields edit as empty inputs rather than a literal em-dash placeholder. The
 * parent passes the row through verbatim, no pre-coalescing.
 */
export default function EditSupplierDialog({
  supplier,
}: {
  supplier: {
    id: string;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  // We drive `pending`/`error` ourselves from the awaited action result rather
  // than reading them out of `useActionState` — same UX (inputs + buttons lock
  // while submitting, error renders inline), but no setState-in-effect.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const result: UpdateSupplierResult = await updateSupplier(formData);
    setPending(false);
    if (result.ok) {
      setOpen(false);
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
      {/* Trigger — pencil icon, matches the trash button's sizing/hover style */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${supplier.name}`}
        title={`Edit ${supplier.name}`}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
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
            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
          />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <h2 className="text-base font-semibold tracking-tight text-zinc-900">
                Edit Supplier
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50"
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

            <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
              {/* Hidden ID — travels in the same payload as the fields so the
                  server action knows which row to update. */}
              <input type="hidden" name="id" value={supplier.id} />

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
                  defaultValue={supplier.name}
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
                    defaultValue={supplier.contactName ?? ""}
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
                    defaultValue={supplier.email ?? ""}
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
                    defaultValue={supplier.phone ?? ""}
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
                    defaultValue={supplier.address ?? ""}
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
                  className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
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
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-50";

/** Labeled field wrapper — keeps the form DRY (matches AddSupplierDialog). */
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
        className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
