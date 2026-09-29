import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/**
 * A headline metric tile: label, big number, optional period-over-period delta.
 *
 * Phase 2's dashboard had four ad-hoc metric cards whose values were set at
 * wildly different sizes, so the four numbers on a row were not visually
 * comparable and the eye had nowhere to land. This fixes the scale:
 *
 *   - the value is always `text-2xl` with `tabular-nums`, so digits line up
 *     vertically across a row of tiles and a dropped digit is visible
 *   - the label is always `text-xs uppercase tracking-wide`, so it reads as a
 *     caption rather than competing with the number
 *   - the delta is a coloured pill ONLY when there is a real baseline.
 *
 * `change` is `null` when there is no comparable previous period, and that
 * renders an explicit "No prior period" note rather than a flat 0% or a
 * fabricated +100% — a store on its first day of trading has no trend, and
 * showing one would be a lie.
 */
export function StatCard({
  label,
  value,
  hint,
  change,
  changeLabel = "vs previous period",
  icon,
  href,
  tone = "default",
}: {
  /** Caption above the number. */
  label: string;
  /** The formatted figure. */
  value: string;
  /** Small line under the value, e.g. "12 transactions". */
  hint?: string;
  /** Signed percentage change, or null when there is no baseline. */
  change?: number | null;
  /** What the delta is measured against. */
  changeLabel?: string;
  icon?: ReactNode;
  /** Makes the whole tile a link, e.g. to the matching report. */
  href?: string;
  /** `warning`/`danger` tint the value, for figures that are themselves alerts. */
  tone?: "default" | "warning" | "danger";
}) {
  const valueTone =
    tone === "danger"
      ? "text-red-600"
      : tone === "warning"
        ? "text-amber-600"
        : "text-slate-900";

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        {icon ? <span className="text-slate-400">{icon}</span> : null}
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueTone}`}>
        {value}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ChangePill change={change} />
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </div>
    </>
  );

  const shell =
    "flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

  if (href) {
    return (
      <Link
        href={href}
        className={`${shell} transition hover:border-indigo-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500`}
      >
        {body}
        <span className="sr-only">{changeLabel}</span>
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/**
 * The delta pill.
 *
 * A `null` change is rendered as a neutral dash with a title explaining why,
 * rather than being hidden: a manager needs to know the number is "no
 * comparison available", not "no change".
 */
function ChangePill({ change }: { change?: number | null }) {
  if (change == null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
        title="No comparable previous period, so there is no change to show"
      >
        <Minus className="h-3 w-3" aria-hidden />
        <span className="sr-only">No prior period</span>
      </span>
    );
  }

  const up = change > 0;
  const flat = change === 0;
  const tone = flat
    ? "bg-slate-100 text-slate-600"
    : up
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-700";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}
    >
      {flat ? (
        <Minus className="h-3 w-3" aria-hidden />
      ) : up ? (
        <ArrowUpRight className="h-3 w-3" aria-hidden />
      ) : (
        <ArrowDownRight className="h-3 w-3" aria-hidden />
      )}
      {flat ? "0%" : `${Math.abs(change).toFixed(1)}%`}
    </span>
  );
}
