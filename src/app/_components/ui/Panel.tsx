import type { ReactNode } from "react";

/**
 * The single card shell every Phase 2 panel is built on.
 *
 * Phase 2 replaced a lot of hand-rolled `rounded-2xl border border-slate-200
 * bg-white p-5 shadow-sm` wrappers, each with its own padding, header weight
 * and empty-state treatment. That drift is what made the app feel like several
 * products. This component is the one place those decisions live:
 *
 *   - identical radius, border, shadow and padding
 *   - a header row with a consistent title/subtitle/action layout
 *   - ONE empty state, so "no data" looks the same on every panel instead of
 *     each view inventing its own dashed box and wording
 *
 * `children` renders inside the body. When there is nothing to show, pass
 * `empty` instead of rendering an empty grid — that is the whole point: an
 * absent dataset should never produce a bare, confusing frame.
 */
export function Panel({
  title,
  subtitle,
  action,
  empty,
  emptyTitle,
  emptyBody,
  children,
  className = "",
  bodyClassName = "",
}: {
  /** The one-line heading. */
  title: string;
  /** Optional supporting line under the title. */
  subtitle?: string;
  /** Optional control rendered at the right of the header (links, filters). */
  action?: ReactNode;
  /** When true, render the empty state INSTEAD of `children`. */
  empty?: boolean;
  /** Heading for the empty state. Defaults to a generic "Nothing here yet". */
  emptyTitle?: string;
  /** Body for the empty state. Defaults to a short, non-technical hint. */
  emptyBody?: string;
  children: ReactNode;
  /** Extra classes on the outer card. */
  className?: string;
  /** Extra classes on the inner body, e.g. to remove padding for a table. */
  bodyClassName?: string;
}) {
  return (
    <section
      className={`flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight text-slate-900">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            {emptyTitle ?? "Nothing to show yet"}
          </p>
          <p className="max-w-xs text-xs text-slate-500">
            {emptyBody ?? "Activity will appear here once there is any to report."}
          </p>
        </div>
      ) : (
        <div className={`flex-1 px-5 py-4 ${bodyClassName}`}>{children}</div>
      )}
    </section>
  );
}
