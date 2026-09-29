import type { HourBucket } from "@/lib/analytics";

/**
 * "Activity by time" for the dashboard: when during the day people actually buy.
 *
 * This replaces the old fixed day x 3-hour heatmap. That grid had two problems
 * that made it read as clutter rather than insight:
 *
 *   1. It always drew eight columns — 12 AM, 3 AM, 6 AM, 9 AM, 12 PM, 3 PM, 6 PM,
 *      9 PM — so four of them were hours a retail till is shut. Half the chart
 *      width was spent on cells that could never have data.
 *   2. To fit eight labels into a third-width card it had to stack each one as
 *      hour-over-meridiem at 10px/8px, which is why the labels were the
 *      smallest text in the dashboard and still needed an overflow fallback.
 *
 * Instead this shows ONE row: a bar per hour that actually has sales, labelled
 * with an ordinary clock time ("9 AM") at normal size. An empty range falls back
 * to a standard 9 AM - 8 PM axis so the card still has structure, but it is
 * built by `hourlyProfile` from real data rather than hard-coded here.
 *
 * Bars are scaled against the busiest hour, not the total, so the peak always
 * fills the panel and the shape of the trading day is actually readable.
 */
export default function ActivityByHour({
  buckets,
  currencySymbol = "P",
}: {
  /** Per-hour totals, already in clock order, from `hourlyProfile`. */
  buckets: HourBucket[];
  currencySymbol?: string;
}) {
  if (buckets.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No sales to chart in this window.
      </p>
    );
  }

  const peak = Math.max(...buckets.map((b) => b.revenue), 0);
  const hasSales = peak > 0;
  // Only mark every other hour once the labels would start to crowd. At nine
  // readable "9 AM"-style labels they comfortably fit; at twenty-four they do not.
  const labelEveryOther = buckets.length > 12;

  return (
    <div role="img" aria-label="Sales by hour of day">
      {/* `items-stretch` (the flex default) is load-bearing: with `items-end` the
          columns would size to their own content and the `flex-1` bar area would
          resolve to zero height, collapsing every bar to nothing. */}
      <div className="flex h-40 gap-1.5">
        {buckets.map((bucket, index) => {
          const heightPct = hasSales
            ? Math.max(3, (bucket.revenue / peak) * 100)
            : 3;
          return (
            <div
              key={bucket.hour}
              className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
            >
              <div className="relative flex w-full flex-1 items-end">
                <div
                  className={
                    hasSales
                      ? "w-full rounded-t-md bg-indigo-500 transition-colors group-hover:bg-indigo-600"
                      : "w-full rounded-t-md bg-slate-200"
                  }
                  style={{ height: `${heightPct}%` }}
                  title={
                    hasSales
                      ? `${bucket.label} - ${money(bucket.revenue, currencySymbol)} across ${bucket.transactions} sale${bucket.transactions === 1 ? "" : "s"}`
                      : `${bucket.label} - no sales`
                  }
                />
              </div>
              {index % (labelEveryOther ? 2 : 1) === 0 ? (
                <span className="truncate text-[11px] font-medium text-slate-600">
                  {bucket.label}
                </span>
              ) : (
                <span className="h-[14px]" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Compact money for the bar tooltips. */
function money(value: number, symbol: string): string {
  const rounded = Math.round(value * 100) / 100;
  return `${symbol}${rounded.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}