"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { receivePurchaseOrder } from "./actions";
import { Modal } from "@/app/_components/ui/Modal";
import {
  Field,
  FormError,
  dialogPrimaryCls,
  dialogSecondaryCls,
  inputCls,
} from "@/app/_components/ui/Field";

type ReceiveLine = {
  lineNumber: number;
  itemId: string;
  productName: string;
  productSku: string;
  orderedQty: number;
  receivedQty: number;
};

export default function ReceiveStockDialog({
  purchaseOrderId,
  poNumber,
  supplierName,
  items,
}: {
  purchaseOrderId: string;
  poNumber: string;
  supplierName: string;
  items: ReceiveLine[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A stable idempotency key for this dialog instance: generated once on mount,
  // never changed, and READ during render (it is the `requestKey` hidden form
  // field, which the server uses to make a retried receipt idempotent).
  //
  // This is state with a lazy initialiser rather than a ref, which is the
  // idiomatic expression of "compute once, stable for the lifetime of this
  // component" and satisfies the `react-hooks/refs` rule - reading
  // `ref.current` during render is what that rule flags. The value the form
  // receives is identical to the ref's: `useRef(crypto.randomUUID())` kept only
  // the first call's result, and a lazy `useState` produces exactly that value
  // once instead of discarding a fresh UUID on every render.
  const [requestKey] = useState(() => crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form);

    // Client-side guards mirroring the server's rules. Each names the line and
    // the permitted quantity so the fix is obvious; entered values stay put.
    for (const item of items) {
      const raw = String(formData.get(`receiveQty_${item.lineNumber}`) ?? "0");
      const qty = Number(raw);
      const remaining = Math.max(0, item.orderedQty - item.receivedQty);
      if (!Number.isInteger(qty) || qty < 0) {
        setError(`Line “${item.productName}”: enter a whole number (0 or more).`);
        return;
      }
      if (qty > remaining) {
        setError(`Cannot receive ${qty}; only ${remaining} remaining.`);
        return;
      }
    }
    const positive = items.some((item) => Number(formData.get(`receiveQty_${item.lineNumber}`) || 0) > 0);
    if (!positive) {
      setError("Enter a quantity for at least one line.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await receivePurchaseOrder(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Stock received for ${poNumber}`);
      setOpen(false);
      formRef.current?.reset();
      window.location.reload();
    } catch {
      setError("Could not record the receipt. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Receive stock
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Receive stock"
        description={`${poNumber} · ${supplierName}`}
        busy={pending}
        className="max-w-3xl"
      >
        <form ref={formRef} onSubmit={submit} className="space-y-4">
              <input type="hidden" name="id" value={purchaseOrderId} />
              <input type="hidden" name="lineCount" value={items.length} />
              <input type="hidden" name="requestKey" value={requestKey} />
              <FormError>{error}</FormError>
              <p className="text-xs text-slate-500">
                Enter how many units arrived for each line. You can receive in
                several deliveries — only the remaining quantity can be received.
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-white/60 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Already received</th><th className="px-3 py-2 text-right">Remaining</th><th className="px-3 py-2 text-right">Receive now</th></tr></thead>
                  <tbody className="divide-y divide-slate-200">
                    {items.map((item) => {
                      const remaining = Math.max(0, item.orderedQty - item.receivedQty);
                      return <tr key={item.itemId}>
                        <td className="px-3 py-2"><input type="hidden" name={`itemId_${item.lineNumber}`} value={item.itemId} />{item.productName}<span className="block font-mono text-xs text-slate-500">{item.productSku}</span></td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.orderedQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.receivedQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">{remaining}</td>
                        <td className="px-3 py-2 text-right"><input name={`receiveQty_${item.lineNumber}`} type="number" min="0" max={remaining} step="1" defaultValue="0" disabled={pending || remaining === 0} onChange={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value) && value > remaining) setError(`Cannot receive ${value}; only ${remaining} remaining.`); else setError(null); }} className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm text-slate-900 disabled:opacity-50" aria-label={`Receive quantity for ${item.productName}`} /></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <Field label="Reference / notes" htmlFor="receive-notes">
                <textarea id="receive-notes" name="notes" rows={2} disabled={pending} className={inputCls} placeholder="Delivery note, supplier reference, etc." />
              </Field>
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={() => setOpen(false)} disabled={pending} className={dialogSecondaryCls}>Cancel</button><button type="submit" disabled={pending} className={dialogPrimaryCls}>{pending ? "Receiving…" : "Confirm receipt"}</button></div>
        </form>
      </Modal>
    </>
  );
}
