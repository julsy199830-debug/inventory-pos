import { getStoreSettings } from "@/app/actions/settings";
import {
  getFinancialSummary,
  type ProductBreakdownRow,
} from "@/app/actions/accounting";
import RangeSelector from "./RangeSelector";

/**
 * The selectable date-range presets. These mirror the values the
 * `RangeSelector` client island writes into the URL (`?range=<preset>`), so the
 * two stay in sync by sharing this one source of truth. "custom" is a placeholder
 * for a future date-picker and currently collapses to the same window as "30d"
 * — but we still accept the token so the URL stays meaningful when the picker
 * lands, and so an unknown or missing token has a deterministic fallback.
 */
type RangePreset = "today" | "7d" | "30d" | "custom";

const PRESET_VALUES = ["today", "7d", "30d", "custom"] as const;
const DEFAULT_PRESET: RangePreset = "30d";

/** Human-readable label for the active window, shown under the page title. */
const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  custom: "Last 30 days",
};

/** Normalize an arbitrary `?range=` query value into a known preset, falling
 * back to the default on anything unrecognized (including array values —
 * `?range=today&range=7d` would otherwise slip a string[] through). */
function resolvePreset(value: string | string[] | undefined): RangePreset {
  const token = Array.isArray(value) ? value[0] : value;
  return PRESET_VALUES.includes(token as RangePreset)
    ? (token as RangePreset)
    : DEFAULT_PRESET;
}

/** Compute the [start, end] date window for a preset, inclusive of both
 * endpoints. `end` is always today; `start` steps back from today. We pass
 * naive date-only values — `getFinancialSummary` re-normalizes the hours to a
 * full-day `[00:00:00.000, 23:59:59.999]` bound itself, so the helper owns the
 * edge semantics and this stays a pure calendar computation. */
function windowFor(preset: RangePreset, now: Date): { start: Date; end: Date } {
  const end = new Date(now);
  const start = new Date(now);
  const backDays = preset === "today" ? 0 : preset === "7d" ? 6 : 29;
  start.setDate(start.getDate() - backDays);
  return { start, end };
}

/** Format a number as currency using the store's symbol. We read the symbol
 * from StoreSetting (the settings page externalizes it for exactly this
 * reason); if no settings row exists yet we fall back to "₱" rather than
 * refusing to render. The amount is formatted with grouping and two decimals,
 * independent of the glyph — yen etc. still get the symbol prepended. */
function money(amount: number, symbol: string): string {
  const body = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = amount < 0 ? "-" : "";
  const glyph = symbol || "₱";
  return `${sign}${glyph}${body}`;
}

/** Format a percentage with one decimal, e.g. 23.456 -> "23.5%". Negative
 * margins (a loss) render with the sign so the table never reads as a positive
 * when it isn't. */
function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export default async function AccountingPage({
  searchParams,
}: {
  // searchParams is a Promise in this Next.js version — see the page file
  // convention docs. The RangeSelector deliberately avoids `useSearchParams`
  // (which would force the route to client-render under a Suspense boundary
  // during prerender); instead the server reads the active preset here and
  // passes it down as a prop, exactly like how CategoryFilter gets its value.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { range } = await searchParams;
  const preset = resolvePreset(range);

  // `now` anchors the window at request time. Both the window and the summary
  // are derived from it so the date label and the figures can never disagree.
  // The store's currency symbol is read in parallel so the page renders with
  // the manager's chosen glyph rather than a hardcoded "₱".
  const now = new Date();
  const { start, end } = windowFor(preset, now);

  const [summary, settings] = await Promise.all([
    getFinancialSummary({ startDate: start, endDate: end }),
    getStoreSettings(),
  ]);
  const symbol = settings?.currencySymbol ?? "₱";

  const { revenue, cogs, tax, profit, margin, productBreakdown } = summary;
  const unitsSold = productBreakdown.reduce(
    (sum, row) => sum + row.quantitySold,
    0,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Accounting
          </h1>
          <p className="text-sm text-slate-500">
            Financial summary for{" "}
            <span className="font-medium text-slate-900">
              {PRESET_LABELS[preset]}
            </span>{" "}
            — completed sales only.
          </p>
        </div>

        {/* Client island: clicking a preset replaces `?range=<preset>`, which
            re-renders this Server Component with a fresh window. Stateless and
            navigation-driven (no useSearchParams) so the route stays
            prerenderable. */}
        <RangeSelector active={preset} />
      </header>

      {/* KPI cards. Mirrors the dashboard home stat tiles; the Positive/negative
          coloring on Net Profit and the margin communicate health at a glance.
          COGS isn't a headline card here — it's the difference between Total
          Revenue and Net Profit, and it's already surfaced per-product in the
          breakdown below (and in `getFinancialSummary`), so the four cards stay
          to the four figures a manager reads first. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Revenue" value={money(revenue, symbol)} />
        <KpiCard
          label="Net Profit"
          value={money(profit, symbol)}
          tone={profit >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Profit Margin"
          value={percent(margin)}
          tone={margin >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Tax"
          value={money(tax, symbol)}
        />
      </div>

      {/* Secondary strip: COGS and units sold. Context-only — COGS backs the
          Net Profit figure above, and units sold summarizes volume. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-5">
          <p className="text-sm font-medium text-slate-500">Cost of Goods Sold</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">
            {money(cogs, symbol)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-5">
          <p className="text-sm font-medium text-slate-500">Units Sold</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">
            {unitsSold.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Per-product profitability breakdown. Sorted by profit desc inside
          getFinancialSummary, so the biggest contributors surface first. The
          margin column colors by sign so a loss can't masquerade as a win. */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Profit by Product
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Ranked by gross profit over the selected range.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 text-right font-medium">Units</th>
                <th className="px-5 py-3 text-right font-medium">Revenue</th>
                <th className="px-5 py-3 text-right font-medium">COGS</th>
                <th className="px-5 py-3 text-right font-medium">Profit</th>
                <th className="px-5 py-3 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productBreakdown.map((row) => (
                <ProductRow
                  key={row.productId}
                  row={row}
                  symbol={symbol}
                />
              ))}
            </tbody>
          </table>
        </div>

        {productBreakdown.length === 0 && (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            No completed sales in this range yet.
          </div>
        )}
      </div>
    </div>
  );
}

/** A single KPI stat tile. `tone` optionally tints the value text so profit /
 * margin read at a glance — neutral by default, green for positive, red for
 * negative. Kept as a tiny presentational helper to keep the table above flat. */
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
      ? "text-blue-700"
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

/** One row of the per-product breakdown. Profit and margin are colored by
 * sign so a product sold at a loss can't read as a contributor. */
function ProductRow({
  row,
  symbol,
}: {
  row: ProductBreakdownRow;
  symbol: string;
}) {
  const profitTone = row.profit >= 0 ? "text-blue-700" : "text-red-700";
  const marginTone = row.margin >= 0 ? "text-blue-700" : "text-red-700";
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-5 py-3 font-medium text-slate-900">
        {row.productName}
      </td>
      <td className="px-5 py-3 text-right text-slate-600">
        {row.quantitySold.toLocaleString()}
      </td>
      <td className="px-5 py-3 text-right text-slate-900">
        {money(row.revenue, symbol)}
      </td>
      <td className="px-5 py-3 text-right text-slate-500">
        {money(row.cogs, symbol)}
      </td>
      <td className={`px-5 py-3 text-right font-medium ${profitTone}`}>
        {money(row.profit, symbol)}
      </td>
      <td className={`px-5 py-3 text-right font-medium ${marginTone}`}>
        {percent(row.margin)}
      </td>
    </tr>
  );
}
