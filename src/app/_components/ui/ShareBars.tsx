import type { ReactNode } from "react";

/** One row of a share-of-total breakdown. */
export type ShareRow = {
  /** Primary label. */
  label: string;
  /** Optional secondary line under the label (SKU, category, cashier). */
  detail?: string;
  /** The figure shown right-aligned. */
  value: string;
  /** 0-100. Drives the bar width. */
  share: number;
  /** Optional trailing element, e.g. a link or a status badge. */
  trailing?: ReactNode;
};

/**
 * Horizontal share bars, shared by every revenue breakdown.
 *
 * The dashboard showed payment mix, category mix and cashier mix as three
 * hand-rolled variants with different bar colours, label sizes and number
 * formatting, which made the same data look like three different features.
 * This is the one implementation.
 *
 * Two details that matter for legibility:
 *   - The bar is scaled against the LARGEST row, not the total. Scaling to the
 *     total would make the top row only as wide as its percentage, so a
 *     60/25/15 split would render as three bars all under 60% of the panel and
 *     waste the space the chart exists to use.
 *   - A non-zero row never renders as a sliver: `max(2, ...)` keeps a 0.4%
 *     line visible instead of collapsing to nothing, which would read as "no
 *     data" rather than "negligible".
 */
export function ShareBars({
  rows,
  tone = "indigo",
  showShare = true,
}: {
  rows: ShareRow[];
  /** Accent family for the filled portion. */
  tone?: "indigo" | "emerald" | "amber" | "slate";
  /** Render the percentage next to the value. */
  showShare?: boolean;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.share), 0.0001);

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-700">
                {row.label}
              </p>
              {row.detail ? (
                <p className="truncate text-xs text-slate-500">{row.detail}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-baseline gap-2">
              <span className="text-sm font-semibold tabular-nums text-slate-900">
                {row.value}
              </span>
              {showShare ? (
                <span className="w-12 text-right text-xs tabular-nums text-slate-500">
                  {row.share.toFixed(1)}%
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${FILL[tone]}`}
              style={{ width: `${Math.max(2, (row.share / max) * 100)}%` }}
            />
          </div>
          {row.trailing}
        </li>
      ))}
    </ul>
  );
}

const FILL: Record<"indigo" | "emerald" | "amber" | "slate", string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  slate: "bg-slate-400",
};
