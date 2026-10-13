"use client";

import { useState } from "react";
import { updateSupplier, type UpdateSupplierResult } from "./actions";
import { Modal } from "@/app/_components/ui/Modal";
import {
  Field,
  FormError,
  dialogPrimaryCls,
  dialogSecondaryCls,
  inputCls,
} from "@/app/_components/ui/Field";

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
        className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
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

      <Modal open={open} onClose={onClose} title="Edit Supplier" busy={pending} className="max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4">
              {/* Hidden ID — travels in the same payload as the fields so the
                  server action knows which row to update. */}
              <input type="hidden" name="id" value={supplier.id} />

              <FormError>{error}</FormError>

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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className={dialogSecondaryCls}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className={dialogPrimaryCls}
                >
                  {pending ? "Saving…" : "Save changes"}
                </button>
              </div>
        </form>
      </Modal>
    </>
  );
}
