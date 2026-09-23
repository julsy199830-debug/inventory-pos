import type { ReactNode } from "react";
import { getStoreSettings } from "@/app/actions/settings";
import { getSalesAnalytics } from "../actions";
import SalesBarChart from "../_components/SalesBarChart";
import CategoryDonutChart from "../_components/CategoryDonutChart";
import OrdersSparkline from "../_components/OrdersSparkline";
import TopProductsTable from "../_components/TopProductsTable";
import { formatMoney } from "../_components/chart-theme";

/**
 * Interactive Sales Analytics â€” `/reports/analytics`.
 *
 * Server Component that loads the full analytics payload in one server action
 * (`getSalesAnalytics`) plus the store's currency symbol, then arranges the
 * Recharts widgets and KPI tiles. The interactivity lives entirely inside the
 * client components (the bar chart's Month/Week toggle, hover tooltips, the
 * sparklines' active-dot tracking), so the page itself stays a plain data
 * hand-off â€” no refetching, no loading state.
 *
 * Layout, mirroring the rest of the dashboard: a KPI tile row (two tiles carry
 * the orders sparkline), then a wide Sales Volume card beside the Category
 * Share donut, then the Top Selling Products table â€” all on the standard
 * rounded-2xl slate-200/80 border + white card.
 */
export default async function SalesAnalyticsPage() {
  const [result, settings] = await Promise.all([
    getSalesAnalytics(),
    getStoreSettings(),
  ]);
  const symbol = settings?.currencySymbol ?? "â‚±";

  if (!result.ok) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
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
          label="Revenue Â· 30 days"
          value={formatMoney(totals.revenue30d, symbol)}
          sparkline={
            <OrdersSparkline data={data.orderTrend} color="blue" height={56} />
          }
        />
        <KpiTile
          label="Orders Â· 30 days"
          value={totals.orders30d.toLocaleString()}
          sparkline={
            <OrdersSparkline data={data.orderTrend} color="blue" height={56} />
          }
        />
        <KpiTile
          label="Avg Order Value"
          value={formatMoney(totals.avgOrderValue30d, symbol)}
        />
        <KpiTile
          label="Top Category"
          value={totals.topCategory?.name ?? "â€”"}
          badge={
            totals.topCategory
              ? `${totals.topCategory.percent.toFixed(1)}% of sales`
              : "No sales yet"
          }
          badgeTone={totals.topCategory ? "blue" : "slate"}
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
      <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
        Sales Analytics
      </h1>
      <p className="text-sm text-slate-500">
        Interactive overview of revenue, payment methods, categories, and top
        movers â€” completed sales only.
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
  badgeTone = "blue",
  sparkline,
}: {
  label: string;
  value: string;
  badge?: string;
  badgeTone?: "blue" | "slate";
  sparkline?: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-150">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">
        {value}
      </p>
      {badge ? (
        <span
          className={[
            "mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            badgeTone === "blue"
              ? "bg-indigo-500/15 text-indigo-300"
              : "bg-slate-800 text-slate-500",
          ].join(" ")}
        >
          {badge}
        </span>
      ) : null}
      {sparkline ? <div className="mt-3 flex-1">{sparkline}</div> : null}
    </div>
  );
}
