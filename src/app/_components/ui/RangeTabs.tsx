import Link from "next/link";
import { RANGE_LABELS, RANGE_ORDER, RANGE_SHORT } from "@/lib/analytics";

/**
 * The date-range control shared by the dashboard and reports.
 *
 * A segmented row of plain links rather than a client component or a `<select>`:
 * picking a range is a navigation, the URL stays shareable and reloadable, and
 * the whole bar prerenders with no client JavaScript. This is the same
 * URL-driven approach the inventory filters and the audit-log filters already
 * use, so filtering behaves the same everywhere in the app.
 *
 * `baseQuery` carries any other active filters (category, cashier, payment
 * method) through the switch, so changing the date range never silently drops
 * the other half of what the user asked for.
 */
export function RangeTabs({
  active,
  baseQuery = {},
  short = false,
  ariaLabel = "Date range",
}: {
  /** The `RangeKey` currently in effect. */
  active: string;
  /** Other active `?`-params to preserve across a range change. */
  baseQuery?: Record<string, string | undefined>;
  /** Abbreviated labels (7D / 30D) for the compact dashboard header. */
  short?: boolean;
  ariaLabel?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
    >
      {RANGE_ORDER.map((key) => {
        const isActive = key === active;
        const params = new URLSearchParams();
        for (const [name, value] of Object.entries(baseQuery)) {
          if (value) params.set(name, value);
        }
        params.set("range", key);
        return (
          <Link
            key={key}
            href={`?${params.toString()}`}
            aria-current={isActive ? "page" : undefined}
            title={RANGE_LABELS[key]}
            className={
              isActive
                ? "rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                : "rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            }
          >
            {short ? RANGE_SHORT[key] : RANGE_LABELS[key]}
          </Link>
        );
      })}
    </nav>
  );
}
