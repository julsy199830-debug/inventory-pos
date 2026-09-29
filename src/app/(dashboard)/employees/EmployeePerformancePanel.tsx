import { Panel } from "@/app/_components/ui/Panel";
import { RangeTabs } from "@/app/_components/ui/RangeTabs";
import { StatCard } from "@/app/_components/ui/StatCard";
import { RANGE_LABELS, resolveRange } from "@/lib/analytics";
import type { EmployeePerformanceData } from "./performance-data";

/**
 * Per-employee sales activity for a chosen window (Phase 2).
 *
 * A sales-activity report, NOT payroll. The schema stores no compensation data,
 * so this deliberately reports only what can be derived honestly: what each
 * person rang up, what they processed back out, and when they were on the clock.
 *
 * Three deliberate choices:
 *
 *   - **Everyone is listed, including zeroes.** A roster row reading "0
 *     transactions" tells a manager the person is on shift and idle; an absent
 *     row is ambiguous between that and "not employed". Hiding the quiet rows
 *     would make the table look complete when it is not.
 *   - **Given back is shown next to what was sold**, not buried. A cashier with
 *     a high refund rate is a training or trust question, and the figure is only
 *     meaningful beside their own revenue.
 *   - **Hours are shown next to the activity they produced.** They are facts
 *     from the shift ledger, not a rate: no money is computed from them, because
 *     there is no rate in the schema to compute it from.
 */
export default function EmployeePerformancePanel({
  data,
  currencySymbol,
  activeRange,
}: {
  data: EmployeePerformanceData;
  currencySymbol: string;
  /** The raw `?range=` token, so the tabs can mark the active one. */
  activeRange: string;
}) {
  const money = (value: number) => `${currencySymbol}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const { totals, rows, storeRevenue } = data;
  const hasSales = storeRevenue > 0;

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Staff revenue"
          value={money(totals.revenue)}
          change={data.revenueChange}
          hint={`${RANGE_LABELS[resolveRange(activeRange)]}, vs previous period`}
        />
        <StatCard
          label="Transactions"
          value={totals.transactions.toLocaleString("en-US")}
          hint="completed sales handled"
        />
        <StatCard
          label="Refunds"
          value={money(totals.refundTotal)}
          hint={`${totals.refunds} refund${totals.refunds === 1 ? "" : "s"} processed`}
          tone={totals.refundTotal > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Voids"
          value={String(totals.voids)}
          hint={money(totals.voidTotal)}
          tone={totals.voids > 0 ? "warning" : "default"}
        />
      </div>

      <Panel
        title="Sales by employee"
        subtitle={`${data.range.from} to ${data.range.to}`}
        action={<RangeTabs active={resolveRange(activeRange)} short />}
        bodyClassName="px-0 py-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 text-right font-medium">Revenue</th>
                <th className="px-4 py-3 text-right font-medium">Share</th>
                <th className="px-4 py-3 text-right font-medium">Sales</th>
                <th className="px-4 py-3 text-right font-medium">Avg order</th>
                <th className="px-4 py-3 text-right font-medium">Given back</th>
                <th className="px-4 py-3 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    No staff records yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const share = hasSales ? (row.revenue / storeRevenue) * 100 : 0;
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{row.name}</p>
                        <p className="text-xs text-slate-500">
                          {row.role.toLowerCase()}
                          {row.active ? "" : " - inactive"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">
                        {money(row.revenue)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {hasSales ? `${share.toFixed(1)}%` : "-"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {row.transactions}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {row.transactions === 0 ? "-" : money(row.averageOrder)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.givenBack > 0 ? (
                          <span className="text-amber-700">
                            {money(row.givenBack)}
                            <span className="ml-1 text-xs text-slate-500">
                              ({row.refundCount}r/{row.voidCount}v)
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {row.hoursWorked > 0 ? `${row.hoursWorked.toFixed(1)}h` : "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}