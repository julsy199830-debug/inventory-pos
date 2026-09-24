import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseOrder } from "../actions";
import PoStatusBadge from "../_components/PoStatusBadge";
import OrderPurchaseOrderButton from "../OrderPurchaseOrderButton";
import CancelPurchaseOrderButton from "../CancelPurchaseOrderButton";
import ReceiveStockDialog from "../ReceiveStockDialog";
import { getReceivingHistory } from "../actions";

/** Format a number as Philippine Peso currency, e.g. 199 -> "₱199.00". */
function formatPrice(value: number): string {
  return value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
}

/** Format a date for the meta grid, e.g. "Aug 20, 2026". */
function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Format a timestamp for the audit line, e.g. "Aug 20, 2026, 3:42 PM". */
function formatDateTime(value: Date): string {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Purchase order detail.
 *
 * Pure Server Component over `getPurchaseOrder()`. Status actions are
 * status-only; stock changes happen only through the receiving receipt flow.
 */
export default async function PurchaseOrderDetailPage({
  params,
}: {
  // params is a Promise in this Next.js version — same convention as the
  // searchParams pages (see purchasing/page.tsx).
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const po = await getPurchaseOrder(id);
  if (!po) notFound();

  // Phase 1 transitions only; same buttons as the list rows.
  const canOrder = po.status === "DRAFT";
  const canCancel = po.status === "DRAFT" || po.status === "ORDERED";
  const canReceive = po.status === "ORDERED" || po.status === "PARTIALLY_RECEIVED";
  const history = canReceive || po.status === "RECEIVED" ? await getReceivingHistory(po.id) : [];

  const meta = [
    { label: "Supplier", value: po.supplierName },
    { label: "Order date", value: formatDate(po.orderDate) },
    { label: "Expected date", value: formatDate(po.expectedDate) },
    { label: "Last updated", value: formatDateTime(po.updatedAt) },
  ];

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div className="space-y-3">
        <Link
          href="/purchasing"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300"
        >
          <span aria-hidden>←</span>
          Back to purchasing
        </Link>

        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-semibold tracking-tight text-slate-100">
                {po.poNumber}
              </h1>
              <PoStatusBadge status={po.status} />
            </div>
            <p className="text-sm text-slate-500">
              {po.itemCount.toLocaleString()}{" "}
              {po.itemCount === 1 ? "item" : "items"} ·{" "}
              <span className="font-medium text-slate-300">
                {formatPrice(po.total)}
              </span>{" "}
              total · created by {po.createdByName}
            </p>
          </div>

          {(canOrder || canCancel) && (
            <div className="flex flex-wrap items-center gap-2">
              {canOrder && (
                <OrderPurchaseOrderButton id={po.id} poNumber={po.poNumber} />
              )}
              {canCancel && (
                <CancelPurchaseOrderButton id={po.id} poNumber={po.poNumber} />
              )}
              {canReceive && (
                <ReceiveStockDialog
                  purchaseOrderId={po.id}
                  poNumber={po.poNumber}
                  supplierName={po.supplierName}
              items={po.items.map((item, index) => ({
                    lineNumber: index + 1,
                    itemId: item.id,
                    productName: item.productName,
                    productSku: item.productSku,
                    orderedQty: item.orderedQty,
                    receivedQty: item.receivedQty,
                  }))}
                />
              )}
            </div>
          )}
        </header>
      </div>

      {/* Meta grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {meta.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {m.label}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-slate-200">
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {po.notes && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-100">Notes</h2>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-300">
            {po.notes}
          </p>
        </div>
      )}

      {/* Line items */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">SKU</th>
                <th scope="col" className="px-4 py-3 font-medium">Product</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Ordered</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Received</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Current stock</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Unit cost</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {po.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No line items on this purchase order.
                  </td>
                </tr>
              ) : (
                po.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-950/60">
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {item.productSku}
                    </td>
                    <td className="px-4 py-3 text-slate-200">{item.productName}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                      {item.orderedQty.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                      {item.receivedQty.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                      {item.stock.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                      {formatPrice(item.unitCost)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-100">
                      {formatPrice(item.lineTotal)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="border-t border-slate-800 bg-slate-950/60">
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-3 text-right text-xs uppercase tracking-wide text-slate-500"
                >
                  Total ({po.itemCount.toLocaleString()}{" "}
                  {po.itemCount === 1 ? "item" : "items"})
                </td>
                <td
                  colSpan={2}
                  className="px-4 py-3 text-right text-base font-semibold text-slate-100"
                >
                  {formatPrice(po.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

        <p className="text-xs text-slate-600">
          Receiving records each delivery and increases product stock atomically. Purchase costs are retained on the PO line; Product.cost is not changed.
        </p>

        {history.length > 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-100">Receiving history</h2>
            <div className="mt-3 space-y-3">
              {history.map((receipt) => (
                <div key={receipt.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-mono text-slate-200">{receipt.referenceNumber}</span>
                    <span className="text-slate-500">{formatDateTime(receipt.receivedAt)} · {receipt.receivedByName}</span>
                  </div>
                  {receipt.notes && <p className="mt-1 text-slate-400">{receipt.notes}</p>}
                  <ul className="mt-2 space-y-1 text-slate-300">
                    {receipt.items.map((item) => <li key={`${receipt.id}-${item.productSku}`}>{item.productName} ({item.productSku}): {item.receivedQty}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

    </div>
  );
}
