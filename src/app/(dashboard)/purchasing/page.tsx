import Link from "next/link";
import {
  getPurchaseOrders,
  getSuppliersForSelect,
  getProductsForSelect,
} from "./actions";
import CreatePurchaseOrderDialog from "./CreatePurchaseOrderDialog";
import PoStatusBadge from "./_components/PoStatusBadge";
import OrderPurchaseOrderButton from "./OrderPurchaseOrderButton";
import CancelPurchaseOrderButton from "./CancelPurchaseOrderButton";

/** Format a number as Philippine Peso currency, e.g. 199 -> "₱199.00". */
function formatPrice(value: number): string {
  return value.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
  });
}

/** Format a date for the table, e.g. "Aug 20, 2026". */
function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Purchasing — Purchase Order list.
 *
 * Pure Server Component. Reads the PO list straight through Prisma via
 * `getPurchaseOrders()` and passes the supplier/product option lists down to the
 * create dialog (a client island that owns its own open state).
 *
 * Phase 1 note: this page is READ + CREATE + STATUS-CHANGE only. Nothing here
 * touches `Product.stock`, `Product.cost`, or `StockMovement` — receiving
 * arrives in a later phase.
 */
export default async function PurchasingPage({
  searchParams,
}: {
  // searchParams is a Promise in this Next.js version — see the page file
  // convention docs on handling filtering with searchParams.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { q = "", status = "" } = await searchParams;
  const query = Array.isArray(q) ? q[0] ?? "" : q;
  const statusFilter = Array.isArray(status) ? status[0] ?? "" : status;
  const term = query.trim().toLowerCase();

  // Fetched in parallel: the PO list plus the option lists the create dialog
  // needs. All three are direct server-side Prisma reads, safe in a Server
  // Component.
  const [allOrders, suppliers, products] = await Promise.all([
    getPurchaseOrders(),
    getSuppliersForSelect(),
    getProductsForSelect(),
  ]);

  const orders = allOrders.filter((po) => {
    const matchesTerm =
      term === "" ||
      po.poNumber.toLowerCase().includes(term) ||
      po.supplierName.toLowerCase().includes(term);
    const matchesStatus = statusFilter === "" || po.status === statusFilter;
    return matchesTerm && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Purchasing
          </h1>
          <p className="text-sm text-slate-500">
            Showing{" "}
            <span className="font-medium text-slate-100">
              {orders.length.toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="font-medium text-slate-100">
              {allOrders.length.toLocaleString()}
            </span>{" "}
            purchase orders
          </p>
        </div>

        {/* Lives outside the filter form below: the dialog renders its own
            <form>, and nesting forms is invalid HTML. */}
        <CreatePurchaseOrderDialog suppliers={suppliers} products={products} />
      </header>

      {/* Controls row — a GET form so submitting updates the URL searchParams,
          which re-renders this Server Component with the filtered rows. */}
      <form
        method="get"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm"
      >
        <div className="min-w-[220px] flex-1">
          <label htmlFor="q" className="sr-only">
            Search purchase orders
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search by PO number or supplier…"
            className="w-full rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
        </div>

        <div>
          <label htmlFor="status" className="sr-only">
            Filter by status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={statusFilter}
            className="rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ORDERED">Ordered</option>
            <option value="PARTIALLY_RECEIVED">Partially received</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <button
          type="submit"
          className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-950"
        >
          Filter
        </button>
      </form>

      {/* PO table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  PO number
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Supplier
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Ordered
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Expected
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Items
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {allOrders.length === 0
                      ? "No purchase orders yet. Create one to get started."
                      : "No purchase orders match these filters."}
                  </td>
                </tr>
              ) : (
                orders.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-950/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/purchasing/${po.id}`}
                        className="font-mono text-sm font-medium text-indigo-300 hover:text-indigo-200"
                      >
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {po.supplierName}
                    </td>
                    <td className="px-4 py-3">
                      <PoStatusBadge status={po.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {formatDate(po.orderDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {formatDate(po.expectedDate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                      {po.itemCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-100">
                      {formatPrice(po.total)}
                    </td>
                    <td className="px-4 py-3">
                      {/* Phase 1 transitions only: DRAFT → ORDERED, and
                          DRAFT/ORDERED → CANCELLED. Nothing here writes stock. */}
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {po.status === "DRAFT" && (
                          <OrderPurchaseOrderButton
                            id={po.id}
                            poNumber={po.poNumber}
                          />
                        )}
                        {(po.status === "DRAFT" || po.status === "ORDERED") && (
                          <CancelPurchaseOrderButton
                            id={po.id}
                            poNumber={po.poNumber}
                          />
                        )}
                        {po.status !== "DRAFT" && po.status !== "ORDERED" && (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
