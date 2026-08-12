import type { ReactNode } from "react";
import { getStoreSettings } from "@/app/actions/settings";
import { getSalesAnalytics } from "../actions";
import SalesBarChart from "../_components/SalesBarChart";
import CategoryDonutChart from "../_components/CategoryDonutChart";
import OrdersSparkline from "../_components/OrdersSparkline";
import TopProductsTable from "../_components/TopProductsTable";
import { formatMoney } from "../_components/chart-theme";

/**
 * Interactive Sales Analytics — `/reports/analytics`.
 *
 * Server Component that loads the full analytics payload in one server action
 * (`getSalesAnalytics`) plus the store's currency symbol, then arranges the
 * Recharts widgets and KPI tiles. The interactivity lives entirely inside the
 * client components (the bar chart's Month/Week toggle, hover tooltips, the
 * sparklines' active-dot tracking), so the page itself stays a plain data
 * hand-off — no refetching, no loading state.
 *
 * Layout, mirroring the rest of the dashboard: a KPI tile row (two tiles carry
 * the orders sparkline), then a wide Sales Volume card beside the Category
 * Share donut, then the Top Selling Products table — all on the standard
 * rounded-2xl slate-200/80 border + white card.
 */
export default async function SalesAnalyticsPage() {
  const [result, settings] = await Promise.all([
    getSalesAnalytics(),
    getStoreSettings(),
  ]);
  const symbol = settings?.currencySymbol ?? "₱";

  if (!result.ok) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      </div>
    );
  }

  const data = result.data;
  const totals = data.totals;

  return (
    <div className="space-y-6">
      <PageHeader />

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Revenue · 30 days"
          value={formatMoney(totals.revenue30d, symbol)}
          sparkline={
            <OrdersSparkline data={data.orderTrend} color="indigo" height={56} />
          }
        />
        <KpiTile
          label="Orders · 30 days"
          value={totals.orders30d.toLocaleString()}
          sparkline={
            <OrdersSparkline data={data.orderTrend} color="emerald" height={56} />
          }
        />
        <KpiTile
          label="Avg Order Value"
          value={formatMoney(totals.avgOrderValue30d, symbol)}
        />
        <KpiTile
          label="Top Category"
          value={totals.topCategory?.name ?? "—"}
          badge={
            totals.topCategory
              ? `${totals.topCategory.percent.toFixed(1)}% of sales`
              : "No sales yet"
          }
          badgeTone={totals.topCategory ? "indigo" : "slate"}
        />
      </div>

      {/* Charts: wide stacked bars + category donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SalesBarChart
            monthly={data.monthly}
            weekly={data.weekly}
            currencySymbol={symbol}
          />
        </div>
        <CategoryDonutChart data={data.categories} currencySymbol={symbol} />
      </div>

      {/* Top movers */}
      <TopProductsTable products={data.topProducts} currencySymbol={symbol} />
    </div>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Sales Analytics
      </h1>
      <p className="text-sm text-slate-500">
        Interactive overview of revenue, payment methods, categories, and top
        movers — completed sales only.
      </p>
    </header>
  );
}

/** One KPI stat tile. `sparkline` children pin to the tile bottom via flex-1
 * so the trend lines align across the row. */
function KpiTile({
  label,
  value,
  badge,
  badgeTone = "indigo",
  sparkline,
}: {
  label: string;
  value: string;
  badge?: string;
  badgeTone?: "indigo" | "slate";
  sparkline?: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      {badge ? (
        <span
          className={[
            "mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            badgeTone === "indigo"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-500",
          ].join(" ")}
        >
          {badge}
        </span>
      ) : null}
      {sparkline ? <div className="mt-3 flex-1">{sparkline}</div> : null}
    </div>
  );
}
