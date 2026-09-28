"use client";

import { useRef, useState } from "react";
import { createCategory, type CategoryResult } from "../actions";
import { Modal } from "@/app/_components/ui/Modal";
import {
  Field,
  FormError,
  dialogPrimaryCls,
  dialogSecondaryCls,
  inputCls,
} from "@/app/_components/ui/Field";

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
        Add Category
      </button>

      {open && (
        <Modal
          open
          onClose={onClose}
          title="Add Category"
          description="Group products so they are easier to browse and filter."
          busy={pending}
        >
          <form onSubmit={onSubmit} ref={formRef} className="space-y-4">
            <FormError>{error}</FormError>

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
                {pending ? "Saving…" : "Add category"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
