import Link from "next/link";
import {
  Banknote,
  Boxes,
  Package,
  Receipt,
  RotateCcw,
  TrendingUp,
} from "lucide-react";
import { getStoreSettings } from "@/app/actions/settings";
import { RANGE_LABELS, resolveRange } from "@/lib/analytics";
import { Panel } from "@/app/_components/ui/Panel";
import { RangeTabs } from "@/app/_components/ui/RangeTabs";
import { ShareBars } from "@/app/_components/ui/ShareBars";
import { StatCard } from "@/app/_components/ui/StatCard";
import ActivityByHour from "./_components/ActivityByHour";
import RevenueTrendChart from "./_components/RevenueTrendChart";
import { getDashboardData } from "./dashboard-data";

/**
 * Dashboard home (Phase 2) - the daily business picture a storekeeper opens
 * first.
 *
 * A Server Component. Every figure comes from `getDashboardData`, which runs
 * one query per resource and hands the rows to the pure helpers in
 * `lib/analytics`, so each card is describing the same window of the same
 * sales. That is a deliberate change from the previous dashboard, which
 * queried separately per card and re-derived totals in JSX - which is why its
 * cards disagreed with each other and with the reports page.
 *
 * Reading order, top to bottom, mirrors what a manager asks in this order:
 * how did today go, is anything about to run out, what is selling, how are we
 * trading by hour, and who closed the last few sales.
 *
 * Range selection is URL-driven (`?range=`) via plain links, matching the
 * inventory and audit-log filters, so a view can be bookmarked or shared and
 * the page stays statically prerenderable with no client navigation state.
 */
export default async function DashboardPage({
  searchParams,
}: {
  // searchParams is a Promise in this Next.js version - see the page file
  // convention docs on handling filtering with searchParams.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { range } = await searchParams;
  const rangeKey = resolveRange(range);
  const [data, settings] = await Promise.all([
    getDashboardData(rangeKey),
    getStoreSettings(),
  ]);
  const symbol = settings?.currencySymbol ?? "P";
  const { totals, today, valuation, adjustments } = data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Dashboard
          </h1>
          {/* The window is its own element so it can be read (and asserted on)
              independently of the label beside it. */}
          <p className="mt-1 text-sm text-slate-500">
            {RANGE_LABELS[rangeKey]}{" "}
            <span className="tabular-nums text-slate-400">
              {data.range.from} to {data.range.to}
            </span>
          </p>
        </div>
        <RangeTabs active={rangeKey} short />
      </header>

      {/* Today's own numbers, kept separate from the selected range so "Today"
          is never a function of which window happens to be open. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's sales"
          value={money(today.revenue, symbol)}
          hint={`${today.transactions} transaction${today.transactions === 1 ? "" : "s"}`}
          icon={<Banknote className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Revenue"
          value={money(totals.revenue, symbol)}
          change={data.revenueChange}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Transactions"
          value={totals.transactions.toLocaleString("en-US")}
          change={data.transactionChange}
          hint={`avg ${money(totals.averageOrder, symbol)}`}
          icon={<Receipt className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Inventory value"
          value={money(valuation.retailValue, symbol)}
          hint={`at cost ${money(valuation.costValue, symbol)}`}
          icon={<Boxes className="h-4 w-4" aria-hidden />}
          href="/inventory"
        />
      </div>

      {/* Restock pressure and leakage: the two things that quietly cost a
          store money, so they sit above the merchandising panels. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard
          label="Needs restock"
          value={String(valuation.outOfStock + valuation.lowStock)}
          hint={`${valuation.outOfStock} out, ${valuation.lowStock} low`}
          tone={valuation.outOfStock > 0 ? "danger" : valuation.lowStock > 0 ? "warning" : "default"}
          icon={<Package className="h-4 w-4" aria-hidden />}
          href="/inventory?status=low"
        />
        <StatCard
          label="Value at risk"
          value={money(valuation.atRiskValue, symbol)}
          hint="retail value sitting on low lines"
          tone={valuation.atRiskValue > 0 ? "warning" : "default"}
          icon={<Boxes className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Refunds & voids"
          value={money(adjustments.totalGivenBack, symbol)}
          hint={
            adjustments.ratePercent == null
              ? "no sales in this window"
              : `${adjustments.ratePercent.toFixed(1)}% of gross sales`
          }
          tone={adjustments.totalGivenBack > 0 ? "warning" : "default"}
          icon={<RotateCcw className="h-4 w-4" aria-hidden />}
          href="/reports"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          title="Sales trend"
          subtitle={
            data.trend.length > 60 ? "Monthly totals" : "Daily totals"
          }
          className="xl:col-span-2"
        >
          <RevenueTrendChart
            data={data.trend.map((p) => ({ label: p.label, revenue: p.revenue }))}
            currencySymbol={symbol}
          />
        </Panel>

        <Panel
          title="Activity by time"
          subtitle="Busiest hours, from actual sales"
        >
          <ActivityByHour buckets={data.hours} currencySymbol={symbol} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Top-selling products"
          subtitle="By revenue in this window"
          action={
            <Link
              href="/reports"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Full report
            </Link>
          }
        >
          <ShareBars
            tone="indigo"
            rows={data.top.map((row) => ({
              label: row.label,
              detail: row.detail,
              value: money(row.revenue, symbol),
              share: row.share,
            }))}
          />
        </Panel>

        <Panel title="Sales by category" subtitle="Where the revenue comes from">
          <ShareBars
            tone="emerald"
            rows={data.categories.map((row) => ({
              label: row.label,
              value: money(row.revenue, symbol),
              share: row.share,
            }))}
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="By payment method" subtitle="Share of revenue">
          <ShareBars
            tone="slate"
            rows={data.payments.map((row) => ({
              label: paymentLabel(row.label),
              value: money(row.revenue, symbol),
              share: row.share,
            }))}
          />
        </Panel>

        <Panel
          title="Restock list"
          subtitle="Out of stock first, then nearest to empty"
          action={
            <Link
              href="/inventory?status=low"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Inventory
            </Link>
          }
        >
          {data.alerts.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Every product is above its low-stock threshold.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.alerts.map((alert) => (
                <li key={alert.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">
                      {alert.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {alert.sku} - {alert.categoryName}
                    </p>
                  </div>
                  <span
                    className={
                      alert.status === "out"
                        ? "shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"
                        : "shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
                    }
                  >
                    {alert.status === "out" ? "Out" : `${alert.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Cashier activity"
          subtitle="Sales handled in this window"
          action={
            <Link
              href="/employees"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              All staff
            </Link>
          }
        >
          {data.employees.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No staff records yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.employees.slice(0, 6).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">
                      {row.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {row.role.toLowerCase()} - {row.transactions} sale
                      {row.transactions === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                    {money(row.revenue, symbol)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent transactions"
        subtitle="Most recent sales in this window"
        bodyClassName="px-0 py-0"
      >
        {data.recent.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">No completed sales yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Sales appear here as soon as the register rings one up.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recent.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700"
                    aria-hidden
                  >
                    {sale.customer.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {sale.customer}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {sale.cashier} - {paymentLabel(sale.method)} -{" "}
                      {sale.at.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {sale.status !== "Completed" ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {sale.status}
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {money(sale.total, symbol)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Format a figure as store currency, with the sign carried outside the glyph. */
function money(value: number, symbol: string): string {
  const body = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "-" : ""}${symbol}${body}`;
}

/** "STORE_CREDIT" -> "Store credit". Mirrors the POS's own payment labels. */
function paymentLabel(method: string): string {
  if (method === "CASH") return "Cash";
  if (method === "CARD") return "Card";
  if (method === "STORE_CREDIT") return "Store credit";
  return method
    .split("_")
    .map((word) => (word[0] ?? "").toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}