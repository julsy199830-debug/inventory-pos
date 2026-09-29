import Link from "next/link";
import { Panel } from "@/app/_components/ui/Panel";
import { RangeTabs } from "@/app/_components/ui/RangeTabs";
import { StatCard } from "@/app/_components/ui/StatCard";
import { RANGE_LABELS, resolveRange } from "@/lib/analytics";
import type { SupplierPerformanceData } from "./supplier-data";

/**
 * Supplier ordering and receiving position for a window (Phase 2).
 *
 * Answers three questions a storekeeper actually has: what have I committed to,
 * what has arrived, and what is still outstanding. Deliberately NOT a supplier
 * score or ranking - the schema holds no quality, price-variance or delivery-
 * contract data, so a "best supplier" list built from it would be an invention
 * wearing a measurement's clothes.
 *
 * Outstanding value is the lead figure: money already committed to goods that
 * are not on the shelf. A large number there is the actionable one.
 */
export default function SupplierPerformancePanel({
  data,
  currencySymbol,
  activeRange,
}: {
  data: SupplierPerformanceData;
  currencySymbol: string;
  /** The raw `?range=` token, so the tabs can mark the active one. */
  activeRange: string;
}) {
  const money = (value: number) =>
    `${currencySymbol}${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const { totals, rows } = data;
  const rangeKey = resolveRange(activeRange);

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Outstanding"
          value={money(totals.outstandingValue)}
          hint={
            totals.openOrders === 0
              ? "no open purchase orders"
              : `${totals.openOrders} open PO${totals.openOrders === 1 ? "" : "s"}`
          }
          tone={totals.outstandingValue > 0 ? "warning" : "default"}
          href="/purchasing"
        />
        <StatCard
          label="Ordered"
          value={money(totals.orderedValue)}
          hint={`${totals.orders} purchase order${totals.orders === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Received"
          value={money(totals.receivedValue)}
          hint="valued at PO unit cost"
        />
        <StatCard
          label="Average lead time"
          value={totals.averageLeadDays == null ? "-" : `${totals.averageLeadDays.toFixed(1)}d`}
          hint={
            totals.averageLeadDays == null
              ? "no deliveries in this window"
              : "order to first receipt"
          }
        />
      </div>

      <Panel
        title="Supplier performance"
        subtitle={`${RANGE_LABELS[rangeKey]} - ${data.range.from} to ${data.range.to}`}
        action={<RangeTabs active={rangeKey} short />}
        bodyClassName="px-0 py-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 text-right font-medium">Catalog lines</th>
                <th className="px-4 py-3 text-right font-medium">POs</th>
                <th className="px-4 py-3 text-right font-medium">Ordered</th>
                <th className="px-4 py-3 text-right font-medium">Received</th>
                <th className="px-4 py-3 text-right font-medium">Open POs</th>
                <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                <th className="px-4 py-3 text-right font-medium">Lead time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    No suppliers yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {row.catalogSkus}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {row.orders}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {money(row.orderedValue)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {money(row.receivedValue)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {row.openOrders || "-"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.outstandingValue > 0 ? (
                        <span className="font-medium text-amber-700">
                          {money(row.outstandingValue)}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {row.averageLeadDays == null ? "-" : `${row.averageLeadDays.toFixed(1)}d`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {data.openByStatus.length > 0 ? (
        <Panel
          title="Open purchase orders"
          subtitle="Committed but not yet received"
          action={
            <Link
              href="/purchasing"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Go to purchasing
            </Link>
          }
        >
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.openByStatus.map((row) => (
              <li
                key={row.status}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {row.status.replace(/_/g, " ").toLowerCase()}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                  {row.count}
                </p>
                <p className="text-xs tabular-nums text-slate-500">
                  {money(row.value)} outstanding
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </section>
  );
}
