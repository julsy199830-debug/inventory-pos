"use client";

/**
 * Phase 6 — the statement date-range filter.
 *
 * A plain GET form rather than a client-side filter: the window belongs in the
 * URL so a filtered statement can be linked, bookmarked and printed, and so the
 * server does the filtering (which is what keeps the running balance correct —
 * the ledger sums the full history and then narrows, it never re-derives a
 * balance from the window alone).
 *
 * `format="date"` gives native date pickers without pulling in a date library.
 */

export default function AccountFilters({
  from,
  to,
}: {
  from?: string;
  to?: string;
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      data-testid="statement-filters"
    >
      <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-600">
        From
        <input
          type="date"
          name="from"
          defaultValue={from ?? ""}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-600">
        To
        <input
          type="date"
          name="to"
          defaultValue={to ?? ""}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
        />
      </label>
      <button
        type="submit"
        className="inline-flex items-center rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
      >
        Apply
      </button>
      <a
        href="."
        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        Clear
      </a>
    </form>
  );
}