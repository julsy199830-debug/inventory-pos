import { getStoreSettings } from "@/app/actions/settings";
import { getDailySummary, getTopSellingProducts, type TopProduct } from "./actions";
import PrintReportButton from "./PrintReportButton";

/**
 * Daily Sales & Z-Report (end-of-day close) — `/reports`.
 *
 * Server Component: reads the optional `?date=YYYY-MM-DD` query (defaults to
 * the store's local "today"), loads the day's summary and top movers via the
 * read-only server actions, and renders:
 *
 *  1. KPI cards (Revenue, Net Profit, Total Transactions, Avg Order Value) —
 *     the four figures a manager reads first.
 *  2. A printable Z-Report sheet carrying `.print-report`, the ONLY element the
 *     `@media print` rules in `globals.css` expose. The toolbar (date picker +
 *     Print button) lives in `.no-print` so it never lands on paper.
 *
 * `searchParams` is a Promise in this Next.js version (see the page file
 * convention docs), so the date is awaited here rather than read
 * synchronously. A malformed or missing date falls back to today; an invalid
 * `YYYY-MM-DD` string surfaces an inline error with the metric cards rendered
 * as dashes rather than crashing the page.
 */

/** `YYYY-MM-DD` for a Date in local time (POS days run on local wall-clock). */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize an arbitrary `?date=` value: take the first array element, fall
 * back to today when missing. The value is validated again in the server
 * action (`dayRange`), but a bare built-in `input[type=date]` always emits a
 * well-formed `YYYY-MM-DD`. */
function resolveDate(value: string | string[] | undefined): string {
  const token = Array.isArray(value) ? value[0] : value;
  return token ?? toISODate(new Date());
}

/** Show a date as "Mon, Jan 5, 2026" for the report header. */
function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a number as money using the store's currency symbol — same helper
 * convention as the accounting page. The glyph falls back to "₱" when no
 * StoreSetting row exists yet. */
function money(amount: number, symbol: string): string {
  const body = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = amount < 0 ? "-" : "";
  return `${sign}${symbol || "₱"}${body}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { date } = await searchParams;
  const isoDate = resolveDate(date);
  const dateLabel = formatDateLabel(isoDate);

  const [summaryResult, topResult, settings] = await Promise.all([
    getDailySummary(isoDate),
    getTopSellingProducts(10, { date: isoDate }),
    getStoreSettings(),
  ]);
  const symbol = settings?.currencySymbol ?? "₱";
  const summary = summaryResult.ok ? summaryResult.data : null;
  const topProducts = topResult.ok ? topResult.data : [];

  // Both actions validate the same `?date=` input, so they fail together —
  // surface whichever message is meaningful rather than silently dropping one.
  const error = !summaryResult.ok
    ? summaryResult.error
    : !topResult.ok
      ? topResult.error
      : null;
  const revenue = summary?.revenue ?? 0;
  const netProfit = summary?.netProfit ?? 0;
  const salesCount = summary?.salesCount ?? 0;
  const avgOrderValue = summary?.avgOrderValue ?? 0;

  return (
    <div className="space-y-6">
      {/* Toolbar — cannot print (wrapped in .no-print). */}
      <div className="no-print">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Reports
            </h1>
            <p className="text-sm text-slate-500">
              End-of-day sales summary & Z-Report — completed sales only.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <form action="/reports" method="get" className="flex items-center gap-3">
              <label
                htmlFor="report-date"
                className="text-sm font-medium text-slate-700"
              >
                Date
              </label>
              <input
                id="report-date"
                name="date"
                type="date"
                defaultValue={isoDate}
                max={toISODate(new Date())}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/10"
              />
              <button
                type="submit"
                className="rounded-xl border border-slate-200/80 bg-white shadow-sm px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Load
              </button>
            </form>
            <PrintReportButton />
          </div>
        </header>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPI cards — the four headline figures of the day. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Revenue" value={money(revenue, symbol)} />
        <KpiCard
          label="Net Profit"
          value={money(netProfit, symbol)}
          tone={netProfit >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Total Transactions"
          value={salesCount.toLocaleString()}
        />
        <KpiCard label="Avg Order Value" value={money(avgOrderValue, symbol)} />
      </div>

      {/* Printable Z-Report sheet. Carries the ONLY printable class in @media
          print; everything else on the page is suppressed by globals.css. */}
      <div className="print-report rounded-xl border border-slate-200 bg-white shadow-sm">
        <ZReportSheet
          storeName={settings?.storeName ?? "My Store"}
          address={settings?.address ?? null}
          phone={settings?.phone ?? null}
          dateLabel={dateLabel}
          isoDate={isoDate}
          symbol={symbol}
          summary={summary}
          topProducts={topProducts}
          money={money}
        />
      </div>
    </div>
  );
}

/** A single KPI stat tile — neutral/positive/negative tone matches the
 * accounting page convention. */
function KpiCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-red-700"
        : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

/** The Z-Report body. This is the document a manager prints at close: store
 * header, date/period, sales totals broken down by payment method, COGS / net
 * profit, and the top movers of the day. Page-break friendly for paper. */
function ZReportSheet({
  storeName,
  address,
  phone,
  dateLabel,
  isoDate,
  symbol,
  summary,
  topProducts,
  money: fmt,
}: {
  storeName: string;
  address: string | null;
  phone: string | null;
  dateLabel: string;
  isoDate: string;
  symbol: string;
  summary: ReturnType<typeof getDailySummary> extends Promise<infer R>
    ? R extends { ok: true; data: infer D }
      ? D
      : null
    : never;
  topProducts: TopProduct[];
  money: (n: number, symbol: string) => string;
}) {
  const cogs = summary?.cogs ?? 0;
  const revenue = summary?.revenue ?? 0;
  const netProfit = summary?.netProfit ?? 0;
  const salesCount = summary?.salesCount ?? 0;
  const isEmpty = !summary || salesCount === 0;

  return (
    <div className="p-6 sm:p-8">
      {/* Header */}
      <header className="flex items-start justify-between border-b-2 border-emerald-600 pb-4">
        <div>
          <p className="text-xl font-bold tracking-tight text-slate-900">
            {storeName}
          </p>
          {address && (
            <p className="mt-0.5 text-sm text-slate-600">{address}</p>
          )}
          {phone && <p className="text-sm text-slate-600">{phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-base font-semibold text-slate-900">
            Z-REPORT / End of Day
          </p>
          <p className="text-sm text-slate-600">{dateLabel}</p>
          <p className="text-xs text-slate-500">Period closing: {isoDate}</p>
        </div>
      </header>

      {isEmpty ? (
        <p className="py-12 text-center text-sm text-slate-500">
          No completed sales recorded for this date.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {/* Sales totals by payment method */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Sales Totals
            </h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 text-left font-medium">Method</th>
                  <th className="py-1.5 text-right font-medium">Count</th>
                  <th className="py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary!.paymentBreakdown.map((row) => (
                  <tr key={row.method} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-900">{row.method}</td>
                    <td className="py-1.5 text-right text-slate-600">
                      {row.count.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-slate-900">
                      {fmt(row.total, symbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-emerald-600">
                  <td className="py-1.5 font-semibold text-slate-900">
                    Gross Revenue
                  </td>
                  <td className="py-1.5 text-right font-semibold text-slate-900">
                    {salesCount.toLocaleString()}
                  </td>
                  <td className="py-1.5 text-right font-semibold text-slate-900">
                    {fmt(revenue, symbol)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* Profit reconciliation */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Profit & Cost of Goods Sold
            </h2>
            <dl className="mt-2 divide-y divide-slate-100 border-b border-slate-300 text-sm">
              <div className="flex justify-between py-1.5">
                <dt className="text-slate-600">Gross Revenue</dt>
                <dd className="text-slate-900">{fmt(revenue, symbol)}</dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="text-slate-600">Cost of Goods Sold</dt>
                <dd className="text-slate-900">− {fmt(cogs, symbol)}</dd>
              </div>
              <div className="flex justify-between border-t-2 border-emerald-600 py-2 font-semibold text-slate-900">
                <dt>Net Profit</dt>
                <dd className={netProfit >= 0 ? "" : "text-red-700"}>
                  {fmt(netProfit, symbol)}
                </dd>
              </div>
            </dl>
          </section>

          {/* Top movers */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Top Selling Products
            </h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 text-left font-medium">Product</th>
                  <th className="py-1.5 text-right font-medium">Units Sold</th>
                  <th className="py-1.5 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((row, i) => (
                  <tr
                    key={row.productId}
                    className={i < topProducts.length - 1 ? "border-b border-slate-100" : ""}
                  >
                    <td className="py-1.5">
                      <span className="font-medium text-slate-900">
                        {row.name}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {row.sku}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-slate-600">
                      {row.quantitySold.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-slate-900">
                      {fmt(row.revenue, symbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Sign-off line */}
          <section className="flex justify-between border-t border-slate-200 pt-6 text-sm text-slate-600">
            <div>
              <p className="font-medium text-slate-900">Manager Signature</p>
              <p className="mt-10 border-b border-slate-400 pb-1 text-xs text-slate-500">
                ______________________________
              </p>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>Clocked out at end of day</p>
              <p>Z-report is a close-out document</p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}