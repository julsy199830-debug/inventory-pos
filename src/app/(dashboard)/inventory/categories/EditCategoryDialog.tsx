"use client";

import { useState } from "react";
import {
  renameCategory,
  setCategoryThreshold,
  type CategoryResult,
} from "../actions";
import { Modal } from "@/app/_components/ui/Modal";

/**
 * Modal dialog for editing an existing category: rename + low-stock threshold.
 *
 * Two separate Server Actions back it ({@link renameCategory} for the name,
 * {@link setCategoryThreshold} for the cutoff) — the schema models them as
 * independent columns and the actions are independently idempotent, so the save
 * handler fires only the ones that actually changed (no-op renames or unchanged
 * thresholds don't round-trip). On the first failure we stop and surface the
 * leak-free error inline; both actions revalidate `/inventory/categories` and
 * `/inventory` on success, so a changed threshold re-flows the inventory badges
 * on the next render without a manual refetch.
 *
 * Same "Event Handlers" calling convention + hand-rolled Tailwind shell as the
 * sibling dialogs (see `EditProductDialog`): we `await` the actions ourselves
 * and close on success, deliberately not `useActionState` so the close lives in
 * the submit handler rather than a render-following effect.
 *
 * The `lowStockThreshold` helper note in `lib/types.ts` is the single rule both
 * this threshold input and the inventory badges honor: a product is Low Stock
 * when `stock < threshold` (0 is always Out of Stock).
 */
export default function EditCategoryDialog({
  category,
}: {
  category: {
    id: string;
    name: string;
    /** Current per-category cutoff. Prefills the threshold input unchanged. */
    lowStockThreshold: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const thresholdStr = String(formData.get("threshold") ?? "").trim();

    // Only fire the actions for fields the user actually changed — a no-op
    // rename (same name) or an unchanged threshold avoids a needless write and
    // its (redundant but harmless) revalidation.
    const nameChanged = name !== "" && name !== category.name;
    const threshold = Number(thresholdStr);
    const thresholdChanged =
      thresholdStr !== "" && Number.isFinite(threshold) && threshold !== category.lowStockThreshold;

    if (!nameChanged && !thresholdChanged) {
      // Nothing to do — close as if saved.
      setOpen(false);
      return;
    }

    setPending(true);
    setError(null);

    // Rename first (the most likely to fail on a P2002 unique clash), then set
    // the threshold. Stop at the first error so we don't half-apply an edit.
    if (nameChanged) {
      const renameFd = new FormData();
      renameFd.set("id", category.id);
      renameFd.set("name", name);
      const r: CategoryResult = await renameCategory(renameFd);
      if (!r.ok) {
        setPending(false);
        setError(r.error ?? null);
        return;
      }
    }

    if (thresholdChanged) {
      const thrFd = new FormData();
      thrFd.set("id", category.id);
      thrFd.set("threshold", thresholdStr);
      const r: CategoryResult = await setCategoryThreshold(thrFd);
      if (!r.ok) {
        setPending(false);
        setError(r.error ?? null);
        return;
      }
    }

    setPending(false);
    setOpen(false);
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
        aria-label={`Edit ${category.name}`}
        title={`Edit ${category.name}`}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
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

      <Modal open={open} onClose={onClose} title="Edit Category" busy={pending} className="max-w-md">
        <form onSubmit={onSubmit} className="space-y-4">
              {/* Hidden ID — travels in the same payload as the fields so the
                  server actions know which row to update. */}
              <input type="hidden" name="id" value={category.id} />

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
                  defaultValue={category.name}
                  className={inputCls}
                />
              </Field>

              <Field label="Low-stock threshold" htmlFor="threshold" required>
                <input
                  id="threshold"
                  name="threshold"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  required
                  disabled={pending}
                  defaultValue={String(category.lowStockThreshold)}
                  className={inputCls}
                />
              </Field>

              <p className="text-xs text-slate-500">
                A product is <span className="font-medium text-slate-700">Low Stock</span> when its stock is below this threshold (0 is always Out of Stock). Raising it flags high-velocity lines sooner; the inventory badges re-flow on save.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white shadow-sm px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save changes"}
                </button>
              </div>
        </form>
      </Modal>
    </>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white shadow-sm px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:bg-white";

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
