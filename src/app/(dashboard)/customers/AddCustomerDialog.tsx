"use client";

import { useRef, useState } from "react";
import { createCustomer, type CustomerInput } from "./actions";
import { Modal } from "@/app/_components/ui/Modal";
import {
  Field,
  FormError,
  inputCls,
} from "@/app/_components/ui/Field";

/**
 * Modal dialog for creating a new customer.
 *
 * Follows the exact shape of the other dialog islands (AddSupplierDialog,
 * AddProductDialog): a self-contained client island that owns the trigger +
 * modal together so the parent page stays a pure Server Component. Submits via
 * a manual async handler that `await`s the raw `createCustomer` Server Action
 * directly — Server Actions resolve to their declared return type, so awaiting
 * one gives us the result in the same tick: close + reset right there on
 * success, no setState-in-effect (the side effects live in the handler).
 *
 * Fields mirror {@link CustomerInput} — name (required), email, phone,
 * address, credit limit (optional, defaults to 0 server-side).
 */
export default function AddCustomerDialog() {
  const [open, setOpen] = useState(false);
  // Driven from the awaited action result rather than `useActionState` — same
  // UX (locked inputs + inline error), but no setState-in-effect.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref so the form resets once the insert succeeds — next open is blank.
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data: CustomerInput = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      email: (form.elements.namedItem("email") as HTMLInputElement).value || null,
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value || null,
      address: (form.elements.namedItem("address") as HTMLInputElement).value || null,
      creditLimit: Number(
        (form.elements.namedItem("creditLimit") as HTMLInputElement).value || 0,
      ),
    };
    setPending(true);
    setError(null);
    const result = await createCustomer(data);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      formRef.current?.reset();
      return;
    }
    setError(result.error);
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
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
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
        Add Customer
      </button>


      {open && (
        <Modal
          open
          onClose={onClose}
          title="Add Customer"
          description="Track a customer's contact details, credit limit, and utang balance."
          busy={pending}
        >
          <form onSubmit={onSubmit} ref={formRef} className="space-y-4">
            <FormError>{error}</FormError>

            <Field label="Name" htmlFor="name" required>
              <input
                id="name"
                name="name"
                type="text"
                required
                disabled={pending}
                placeholder="e.g. Maria Santos"
                className={inputCls}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" htmlFor="email">
                <input
                  id="email"
                  name="email"
                  type="email"
                  disabled={pending}
                  placeholder="e.g. maria@example.com"
                  className={inputCls}
                />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  disabled={pending}
                  placeholder="e.g. 0917 123 4567"
                  className={inputCls}
                />
              </Field>
            </div>

            <Field label="Address" htmlFor="address">
              <input
                id="address"
                name="address"
                type="text"
                disabled={pending}
                placeholder="e.g. 123 Rizal St, Quezon City"
                className={inputCls}
              />
            </Field>

            <Field label="Credit limit" htmlFor="creditLimit">
              <input
                id="creditLimit"
                name="creditLimit"
                type="number"
                min="0"
                step="1"
                disabled={pending}
                placeholder="0"
                className={inputCls}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
              >
                {pending ? "Saving…" : "Save customer"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
