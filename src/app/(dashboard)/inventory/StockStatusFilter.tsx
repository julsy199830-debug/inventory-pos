import Link from "next/link";

/**
 * Stock-state filter for the inventory table: All / Low stock / Out of stock.
 *
 * Plain links rather than a client component or a `<select>`, matching
 * `CategoryFilter` and the audit-log filters: filtering is a navigation, so the
 * URL stays shareable and the control prerenders with no client JavaScript.
 *
 * The counts on each tab are the honest reason to use it. "Low stock 14" is a
 * work queue; "Low stock 0" tells the storekeeper at a glance that there is
 * nothing to triage, without having to switch tabs and find out.
 *
 * `baseQuery` carries the text search and category through a status change, so
 * the two filters compose instead of one silently replacing the other.
 */
export default function StockStatusFilter({
  active,
  counts,
  baseQuery = {},
}: {
  /** The status currently applied. */
  active: string;
  /** Count per status, so the tabs can show a work queue rather than a label. */
  counts: Record<string, number>;
  /** Other active `?`-params to preserve across a status change. */
  baseQuery?: Record<string, string | undefined>;
}) {
  const tabs: { key: string; label: string }[] = [
    { key: "all", label: "All" },
    { key: "low", label: "Low stock" },
    { key: "out", label: "Out of stock" },
  ];

  return (
    <nav aria-label="Filter by stock status" className="flex flex-wrap items-center gap-1">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const params = new URLSearchParams();
        for (const [name, value] of Object.entries(baseQuery)) {
          if (value) params.set(name, value);
        }
        if (tab.key !== "all") params.set("status", tab.key);
        const count = counts[tab.key] ?? 0;

        return (
          <Link
            key={tab.key}
            href={`?${params.toString()}`}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800"
                : "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            }
          >
            {tab.label}
            <span
              className={
                isActive
                  ? "rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
                  : count === 0
                    ? "rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-400"
                    : "rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700"
              }
            >
              {count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}