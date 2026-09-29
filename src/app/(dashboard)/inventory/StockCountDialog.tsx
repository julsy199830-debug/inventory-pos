"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { applyStockCount } from "./actions";
import { Modal } from "@/app/_components/ui/Modal";
import {
  Field,
  FormError,
  dialogPrimaryCls,
  dialogSecondaryCls,
  inputCls,
} from "@/app/_components/ui/Field";
import ProductThumb from "@/app/_components/ui/ProductThumb";

/** Minimal product shape the count sheet needs — fed by the inventory page. */
export type CountableProduct = {
  id: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  stock: number;
};

/** Why the count came out different — becomes the stock-movement reason. */
const REASONS = [
  "Physical count",
  "Shrinkage / theft",
  "Damaged or expired",
  "Miscount corrected",
  "Found stock",
] as const;

/** Mirrors the server's 1,000-line ceiling so we fail fast, not on submit. */
const MAX_LINES = 1000;

/**
 * Physical stock count sheet.
 *
 * The shelf is the source of truth, the system is the hypothesis. This walks
 * the catalog, shows what the system believes next to what the counter typed,
 * and flags the variance before anything is written — so a count is a
 * reconciliation with evidence, not a blind "set stock to N".
 *
 * UX decisions that matter for a back-of-house task:
 *  - Rows are pre-filled with the system quantity, so a full pass is "type over
 *    the exceptions" rather than "key in 200 numbers", and an untouched row can
 *    never silently zero a product.
 *  - Variance is computed live and summarised in the footer *before* submit, so
 *    nobody discovers a 40-unit shrink after the fact.
 *  - Blank or non-integer cells block submission rather than being coerced — an
 *    empty `<input>` reaches the server as `""`, which `load()` turns into
 *    `undefined` -> `NaN`; treating that as zero would wipe out real stock.
 *
 * Fields use the codebase's repeating convention (`lineCount`, `productId_1`,
 * `counted_1`, …) that `applyStockCount` parses.
 */
export default function StockCountDialog({
  products,
}: {
  products: CountableProduct[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>(REASONS[0]);
  // Keyed by product id (not row index) so a row keeps its typed value even if
  // the list is ever re-ordered; the index is only the wire format.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const tooMany = products.length > MAX_LINES;

  const tally = useMemo(() => {
    let adjusted = 0;
    let matched = 0;
    let net = 0;
    let bad = 0;
    for (const p of products) {
      const raw = counts[p.id];
      if (raw === undefined || raw.trim() === "") {
        bad += 1;
        continue;
      }
      const counted = Number(raw);
      if (!Number.isInteger(counted) || counted < 0) {
        bad += 1;
        continue;
      }
      const d = counted - p.stock;
      if (d === 0) matched += 1;
      else {
        adjusted += 1;
        net += d;
      }
    }
    return { adjusted, matched, net, bad };
  }, [counts, products]);

  const blocked = tooMany || tally.bad > 0 || tally.adjusted === 0;

  function openSheet() {
    const seed: Record<string, string> = {};
    for (const p of products) seed[p.id] = String(p.stock);
    setCounts(seed);
    setReason(REASONS[0]);
    setError(null);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    // Serialize the live form so the indexed hidden inputs and typed values are
    // exactly what the user sees on screen.
    const result = await applyStockCount(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const { applied, matched, netChange } = result.data;
    toast.success(
      applied === 0
        ? `Count reconciled — ${matched} line${matched === 1 ? "" : "s"} matched, no changes.`
        : `Count applied — ${applied} adjusted, ${matched} matched, net ${netChange > 0 ? "+" : ""}${netChange}.`,
    );
    setOpen(false);
    formRef.current?.reset();
  }


  return (
    <>
      <button type="button" onClick={openSheet} className={dialogSecondaryCls}>
        Stock count
      </button>

      {open && (
        <Modal
          open
          onClose={close}
          title="Physical stock count"
          description="Pre-filled with what the system believes. Type over the exceptions — only rows that differ are written to the stock ledger."
          className="max-w-3xl"
          busy={pending}
        >
          <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
            <input type="hidden" name="lineCount" value={products.length} />

            <Field label="Reason for the adjustment" htmlFor="countReason">
              <select
                id="countReason"
                name="countReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
                className={inputCls}
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>

            <FormError>
              {tooMany
                ? `This catalog has ${products.length} products, over the ${MAX_LINES}-line limit. Count a category at a time.`
                : error}
            </FormError>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="w-12 py-2 pr-3">
                      <span className="sr-only">Image</span>
                    </th>
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="w-16 py-2 pr-3 text-right font-medium">System</th>
                    <th className="w-24 py-2 pr-3 font-medium">Counted</th>
                    <th className="w-20 py-2 text-right font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p, i) => {
                    const raw = counts[p.id] ?? "";
                    const counted = Number(raw);
                    const valid =
                      raw.trim() !== "" && Number.isInteger(counted) && counted >= 0;
                    const delta = valid ? counted - p.stock : 0;
                    // Wire format is 1-based and positional (productId_1,
                    // counted_1, …) — this is what applyStockCount iterates.
                    const n = i + 1;
                    return (
                      <tr key={p.id}>
                        <td className="py-2 pr-3">
                          <ProductThumb
                            imageUrl={p.imageUrl}
                            name={p.name}
                            size="sm"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <span className="block truncate font-medium text-slate-900">
                            {p.name}
                          </span>
                          <span className="block font-mono text-[10px] uppercase text-slate-500">
                            {p.sku}
                          </span>
                          <input type="hidden" name={`productId_${n}`} value={p.id} />
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                          {p.stock}
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            name={`counted_${n}`}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            disabled={pending}
                            value={raw}
                            aria-label={`Counted quantity for ${p.name}`}
                            aria-invalid={raw.trim() !== "" && !valid}
                            onChange={(e) =>
                              setCounts((c) => ({ ...c, [p.id]: e.target.value }))
                            }
                            className={`${inputCls} h-9 px-2 text-sm tabular-nums`}
                          />
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums font-medium ${
                            !valid
                              ? "text-rose-600"
                              : delta === 0
                                ? "text-slate-400"
                                : delta < 0
                                  ? "text-rose-600"
                                  : "text-emerald-600"
                          }`}
                        >
                          {valid
                            ? delta === 0
                              ? "—"
                              : delta > 0
                                ? `+${delta}`
                                : delta
                            : "?"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Sticky so the running summary and the Apply button stay reachable
                while scrolling a 200-row count sheet. Negative margins make it
                full-bleed against the Modal body's px-5/py-5 padding, and the
                opaque background stops rows showing through underneath. */}
            <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                <span className="font-semibold text-slate-700">
                  {tally.adjusted}
                </span>{" "}
                to adjust · {tally.matched} matched · net{" "}
                <span
                  className={`font-semibold ${
                    tally.net === 0
                      ? "text-slate-700"
                      : tally.net < 0
                        ? "text-rose-600"
                        : "text-emerald-600"
                  }`}
                >
                  {tally.net > 0 ? "+" : ""}
                  {tally.net}
                </span>
                {tally.bad > 0 ? (
                  <span className="mt-0.5 block font-medium text-rose-600">
                    {tally.bad} row{tally.bad === 1 ? "" : "s"} need a whole number of
                    0 or more
                  </span>
                ) : null}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className={dialogSecondaryCls}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || blocked}
                  className={dialogPrimaryCls}
                  title={
                    tooMany
                      ? "Catalog is larger than the 1,000-line limit"
                      : tally.bad > 0
                        ? "Fix the highlighted quantities first"
                        : tally.adjusted === 0
                          ? "Nothing differs yet — change a counted quantity to apply"
                          : undefined
                  }
                >
                  {pending
                    ? "Applying…"
                    : tally.adjusted === 0
                      ? "Nothing to apply"
                      : `Apply ${tally.adjusted} adjustment${tally.adjusted === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
