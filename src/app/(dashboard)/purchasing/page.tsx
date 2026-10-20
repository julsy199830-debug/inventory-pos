import { getFormatSettings } from "@/lib/store-config";
import { formatMoney, type FormatSettings } from "@/lib/format";
import {
  EmptyState,
  FilterBar,
  PageHeader,
  TableCard,
  TableHead,
} from "@/app/_components/ui/PageHeader";
import { buttonCls } from "@/app/_components/ui/Button";
import { inputCls, selectCls } from "@/app/_components/ui/Field";
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
function formatPrice(value: number, format: FormatSettings): string {
  return formatMoney(value, format);
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
  const format = await getFormatSettings();

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
      {/* Phase 7 Step 4: title → description → count → primary action. */}
      <PageHeader
        helpId="purchasing"
        title="Purchasing"
        description="Manage purchase orders and track what is owed."
        meta={
          <>
            Showing{" "}
            <span className="font-medium text-slate-900">
              {orders.length.toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="font-medium text-slate-900">
              {allOrders.length.toLocaleString()}
            </span>{" "}
            orders
          </>
        }
        actions={
          <>
            {/* Renders its own <form> for the createPO Server Action, so it
                lives outside the filter form below — nesting forms is invalid
                HTML. */}
            <CreatePurchaseOrderDialog suppliers={suppliers} products={products} />
          </>
        }
      />

      {/* Controls row — a GET form so submitting updates the URL searchParams,
          which re-renders this Server Component with the filtered rows. The
          form is a plain block wrapper; the shared FilterBar provides the
          visual band around its controls. */}
      <form method="get">
        <FilterBar>
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
              className={inputCls}
            />
          </div>

          <div className="w-44">
            <label htmlFor="status" className="sr-only">
              Filter by status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={statusFilter}
              className={selectCls}
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="ORDERED">Ordered</option>
              <option value="PARTIALLY_RECEIVED">Partially received</option>
              <option value="RECEIVED">Received</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <button type="submit" className={buttonCls("secondary", "md")}>
            Filter
          </button>
        </FilterBar>
      </form>

      {/* PO table */}
      <TableCard label="Purchase orders">
        <TableHead>
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
            </TableHead>
            <tbody className="divide-y divide-slate-200/80">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center">
                    <EmptyState
                      title={
                        allOrders.length === 0
                          ? "No purchase orders yet."
                          : "No purchase orders match these filters."
                      }
                      body={
                        allOrders.length === 0
                          ? "Create one to get started."
                          : [
                              query.trim() ? `search "${query.trim()}"` : null,
                              statusFilter ? `status "${statusFilter}"` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                      }
                    />
                  </td>
                </tr>
              ) : (
                orders.map((po) => (
                  <tr key={po.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/purchasing/${po.id}`}
                        className="font-mono text-sm font-medium text-indigo-700 hover:text-indigo-600"
                      >
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {po.supplierName}
                    </td>
                    <td className="px-4 py-3">
                      <PoStatusBadge status={po.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDate(po.orderDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDate(po.expectedDate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {po.itemCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                      {formatPrice(po.total, format)}
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
      </TableCard>
    </div>
  );
}
