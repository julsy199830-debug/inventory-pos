"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { receivePurchaseOrder } from "./actions";

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
  const requestKeyRef = useRef<string>(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const positive = items.some((item) => Number(formData.get(`receiveQty_${item.lineNumber}`) || 0) > 0);
    if (!positive) {
      setError("Enter a quantity for at least one line.");
      setPending(false);
      return;
    }
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
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="receive-stock-title">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="receive-stock-title" className="text-lg font-semibold text-slate-100">Receive stock</h2>
                <p className="mt-1 text-sm text-slate-400">{poNumber} · {supplierName}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800" aria-label="Close">×</button>
            </div>
            <form ref={formRef} onSubmit={submit} className="mt-5 space-y-4">
              <input type="hidden" name="id" value={purchaseOrderId} />
              <input type="hidden" name="lineCount" value={items.length} />
              <input type="hidden" name="requestKey" value={requestKeyRef.current} />
              {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-slate-950/60 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Already received</th><th className="px-3 py-2 text-right">Remaining</th><th className="px-3 py-2 text-right">Receive now</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {items.map((item) => {
                      const remaining = Math.max(0, item.orderedQty - item.receivedQty);
                      return <tr key={item.itemId}>
                        <td className="px-3 py-2"><input type="hidden" name={`itemId_${item.lineNumber}`} value={item.itemId} />{item.productName}<span className="block font-mono text-xs text-slate-500">{item.productSku}</span></td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.orderedQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.receivedQty}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-300">{remaining}</td>
                        <td className="px-3 py-2 text-right"><input name={`receiveQty_${item.lineNumber}`} type="number" min="0" max={remaining} step="1" defaultValue="0" disabled={pending || remaining === 0} onChange={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value) && value > remaining) setError(`Cannot receive ${value}; only ${remaining} remaining.`); }} className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-right text-sm text-slate-100 disabled:opacity-50" aria-label={`Receive quantity for ${item.productName}`} /></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <div><label htmlFor="receive-notes" className="text-xs font-medium uppercase tracking-wide text-slate-400">Reference / notes</label><textarea id="receive-notes" name="notes" rows={2} disabled={pending} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" placeholder="Delivery note, supplier reference, etc." /></div>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-xl border border-slate-700 px-3.5 py-2 text-sm text-slate-300 disabled:opacity-50">Cancel</button><button type="submit" disabled={pending} className="rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Receiving…" : "Confirm receipt"}</button></div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
