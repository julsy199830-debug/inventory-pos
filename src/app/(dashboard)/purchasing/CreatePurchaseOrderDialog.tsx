"use client";

import { useRef, useState } from "react";
import { createPurchaseOrder, type CreatePoResult } from "./actions";
import { Modal } from "@/app/_components/ui/Modal";
import { Field, inputCls } from "@/app/_components/ui/Field";

type SupplierOption = { id: string; name: string };
type ProductOption = { id: string; name: string; sku: string };

/**
 * Modal dialog for creating a new purchase order (Phase 1: DRAFT creation).
 *
 * Same shape as `AddSupplierDialog`: a self-contained client island that owns
 * the trigger + modal, submits by awaiting the raw `createPurchaseOrder` Server
 * Action from a manual `onSubmit` handler (the action returns a result object,
 * not `Promise<void>`), and closes + resets on success. `revalidatePath` inside
 * the action refreshes the list Server Component, so no local state tracks the
 * new row.
 *
 * Line items are dynamic: the form posts `lineCount` plus `productId_N` /
 * `orderedQty_N` / `unitCost_N` for N = 1..lineCount — the exact contract
 * `createPurchaseOrder` parses. The product option list carries only
 * id/name/sku (no catalog cost), so unit cost is typed fresh per line.
 */
export default function CreatePurchaseOrderDialog({
  suppliers,
  products,
}: {
  suppliers: SupplierOption[];
  products: ProductOption[];
}) {
  const [open, setOpen] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reset target so a successful submit clears the form for next time.
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    // Cheap client-side mirrors of the server's validation so the common
    // mistakes never round-trip; the server remains authoritative. A fully
    // empty line is skipped by the server, so the client skips it too; a
    // partially-filled line is rejected here with a precise message instead
    // of being silently dropped server-side.
    const supplierId = String(formData.get("supplierId") ?? "");
    if (!supplierId) {
      setError("Supplier is required.");
      return;
    }
    const lines = Number(formData.get("lineCount") ?? 0);
    let filled = 0;
    for (let i = 1; i <= lines; i++) {
      const productId = String(formData.get(`productId_${i}`) ?? "");
      const qtyRaw = String(formData.get(`orderedQty_${i}`) ?? "");
      const costRaw = String(formData.get(`unitCost_${i}`) ?? "");
      if (!productId && !qtyRaw && !costRaw) continue; // empty line — server skips it too
      if (!productId) {
        setError(`Line ${i}: choose a product (or leave the whole line empty).`);
        return;
      }
      if (!qtyRaw) {
        setError(`Line ${i}: quantity is required.`);
        return;
      }
      if (!costRaw) {
        setError(`Line ${i}: unit cost is required.`);
        return;
      }
      const qty = Number(qtyRaw);
      const cost = Number(costRaw);
      if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
        setError(`Line ${i}: quantity must be a positive whole number.`);
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        setError(`Line ${i}: unit cost must be a number (0 or more).`);
        return;
      }
      filled += 1;
    }
    if (filled === 0) {
      setError("At least one line item is required.");
      return;
    }

    setPending(true);
    setError(null);
    const result: CreatePoResult = await createPurchaseOrder(formData);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      setLineCount(1);
      formRef.current?.reset();
      return;
    }
    setError(result.error ?? "Could not create the purchase order.");
  }

  function onClose() {
    if (pending) return; // don't dismiss mid-submit
    setOpen(false);
    setError(null);
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
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New purchase order
      </button>

      {open && (
        <Modal
          open
          onClose={onClose}
          title="New purchase order"
          description="Saved as a draft — nothing is ordered or received yet."
          className="max-w-2xl"
        >
          <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
            <input type="hidden" name="lineCount" value={lineCount} />
            <Field label="Supplier" htmlFor="po-supplier" required>
              <select
                id="po-supplier"
                name="supplierId"
                required
                disabled={pending}
                className={inputCls}
                defaultValue=""
              >
                <option value="" disabled>
                  {suppliers.length > 0 ? "Select a supplier…" : "No suppliers yet"}
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Expected date" htmlFor="po-expected">
                <input
                  id="po-expected"
                  name="expectedDate"
                  type="date"
                  disabled={pending}
                  className={inputCls}
                />
              </Field>
              <Field label="Notes" htmlFor="po-notes">
                <input
                  id="po-notes"
                  name="notes"
                  type="text"
                  disabled={pending}
                  placeholder="Optional"
                  className={inputCls}
                />
              </Field>
            </div>

            {/* Line items — each row posts productId_N/orderedQty_N/unitCost_N */}
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Line items
                </p>
                <button
                  type="button"
                  onClick={() => setLineCount((n) => n + 1)}
                  disabled={pending}
                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-slate-900"
                >
                  + Add line
                </button>
              </div>

              {Array.from({ length: lineCount }, (_, idx) => {
                const n = idx + 1;
                return (
                  <div key={n} className="grid grid-cols-12 items-end gap-2">
                    <div className="col-span-7">
                      <Field label={`Line ${n} — product`} htmlFor={`po-product-${n}`}>
                        <select
                          id={`po-product-${n}`}
                          name={`productId_${n}`}
                          disabled={pending}
                          className={inputCls}
                          defaultValue=""
                        >
                          <option value="">Skip this line</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.sku})
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="col-span-2">
                      <Field label="Qty" htmlFor={`po-qty-${n}`}>
                        <input
                          id={`po-qty-${n}`}
                          name={`orderedQty_${n}`}
                          type="number"
                          min={1}
                          step={1}
                          placeholder="0"
                          disabled={pending}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                    <div className="col-span-2">
                      <Field label="Unit cost" htmlFor={`po-cost-${n}`}>
                        <input
                          id={`po-cost-${n}`}
                          name={`unitCost_${n}`}
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="0.00"
                          disabled={pending}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                    <div className="col-span-1 pb-1">
                      <button
                        type="button"
                        onClick={() => setLineCount((c) => Math.max(1, c - 1))}
                        disabled={pending || lineCount <= 1}
                        aria-label="Remove the last line"
                        className="w-full rounded-lg border border-slate-800 px-2 py-2 text-xs font-medium text-red-400 hover:bg-slate-900 disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {error && (
              <p role="alert" className="text-sm font-medium text-red-400">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-950 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create draft"}
              </button>
            </div>

          </form>
        </Modal>
      )}
    </>
  );
}
