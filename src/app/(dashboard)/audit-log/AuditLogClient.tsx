"use client";

/**
 * The audit log table, filters and export (Phase 1e).
 *
 * Filtering is URL-driven rather than state-driven: the filter bar is a plain
 * `<form method="get">` and each control carries a `name`, so applying filters is
 * a navigation. That makes the view shareable and reloadable, and reuses the
 * exact GET-form pattern the inventory page already ships — no router plumbing,
 * no duplicated state, and the browser Back button does the obvious thing.
 *
 * Rows arrive pre-rendered from the Server Component (first 100, newest first),
 * so the page is useful with JavaScript still loading.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Download, Search, X } from "lucide-react";
import { downloadCsv, downloadSpreadsheet } from "@/lib/csv";
import { formatAuditValue } from "@/lib/audit-format";
import type { AuditActor, AuditLogRow } from "./actions";

export type AuditFilters = {
  query: string;
  module: string;
  action: string;
  userId: string;
  from: string;
  to: string;
};

type Props = {
  initialRows: AuditLogRow[];
  /** The `?q=` that produced `initialRows`, so the box is not blank on load. */
  initialQuery: string;
  total: number;
  hasMore: boolean;
  actors: AuditActor[];
  modules: { value: string; label: string }[];
  actions: { value: string; label: string; module: string }[];
  /**
   * The filters the server applied, echoed from the URL.
   *
   * Required, not optional, and this is a correctness point rather than a
   * convenience: the filter controls are UNCONTROLLED (`defaultValue`, because
   * the form is what applies them). Without seeding them from the URL, a user
   * who filters by module and then reloads gets a correctly-filtered list under
   * a dropdown that reads "All modules" — the one state where the UI actively
   * misleads about what is on screen.
   */
  activeFilters: { module: string; action: string; userId: string; from: string; to: string };
};

/** Export column order. */
const EXPORT_HEADERS = [
  "Date/Time",
  "Employee",
  "Action",
  "Module",
  "Record",
  "Record ID",
  "Summary",
  "Changes",
];

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/**
 * Flatten a row's before/after pair into `field: old -> new` strings.
 *
 * Compared with `JSON.stringify` rather than `===` so `0` vs `"0"` and `false`
 * vs `"false"` register as changes — a stock level of `0` written as the string
 * `"0"` is a real difference worth showing, and loose equality would hide it.
 */
function diffOf(row: AuditLogRow): string[] {
  const before = row.before ?? {};
  const after = row.after ?? {};
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: string[] = [];
  for (const field of fields) {
    const from = before[field];
    const to = after[field];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    out.push(
      `${field}: ${formatAuditValue(from as never)} → ${formatAuditValue(to as never)}`,
    );
  }
  return out.sort();
}

export default function AuditLogClient({
  initialRows,
  initialQuery,
  total,
  hasMore,
  actors,
  modules,
  actions,
  activeFilters,
}: Props) {
  // Debounced search box: local value for responsiveness, submit to apply.
  // Seeded from `?q=` so the box shows the search that actually ran. The other
  // filters are uncontrolled `defaultValue`s on server-rendered selects; this
  // one has to be stateful for the clear button, so it needs the same seeding.
  const [query, setQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toRows = () =>
    initialRows.map((row) => [
      fmtDateTime(row.createdAt),
      row.actor ?? "",
      row.actionLabel,
      row.module,
      row.entity ?? "",
      row.entityId ?? "",
      row.summary,
      diffOf(row).join("; "),
    ]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filters ──────────────────────────────────────────────────── */}
      <AuditFiltersForm
        query={query}
        setQuery={setQuery}
        actors={actors}
        modules={modules}
        actions={actions}
        active={activeFilters}
      />

      {/* ── Results ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Showing <span className="font-semibold text-slate-700">{initialRows.length}</span> of{" "}
          <span className="font-semibold text-slate-700">{total}</span> entries
          {hasMore ? " (newest 100 shown)" : ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => downloadCsv("invpos-audit-log.csv", EXPORT_HEADERS, toRows())}
            disabled={initialRows.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button
            type="button"
            onClick={() =>
              downloadSpreadsheet("invpos-audit-log.xls", EXPORT_HEADERS, toRows())
            }
            disabled={initialRows.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Export Excel
          </button>
        </div>
      </div>

      <AuditRows rows={initialRows} expanded={expanded} setExpanded={setExpanded} />
    </div>
  );
}

/** Shared control classes, so the filter bar stays visually uniform. */
const FILTER_SELECT =
  "h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25";
const FILTER_LABEL =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

/** The filter bar. A GET form, so applying filters is a navigation. */
function AuditFiltersForm({
  query,
  setQuery,
  actors,
  modules,
  actions,
  active,
}: {
  query: string;
  setQuery: (v: string) => void;
  actors: AuditActor[];
  modules: { value: string; label: string }[];
  actions: { value: string; label: string; module: string }[];
  active: { module: string; action: string; userId: string; from: string; to: string };
}) {
  return (
    <form
      method="get"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1">
          <label htmlFor="audit-q" className={FILTER_LABEL}>
            Search
          </label>
          <Search
            className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-slate-400"
            aria-hidden
          />
          <input
            id="audit-q"
            name="q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Employee, action, record…"
            className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
        </div>

        <div>
          <label htmlFor="audit-module" className={FILTER_LABEL}>
            Module
          </label>
          <select id="audit-module" name="module" defaultValue={active.module} className={FILTER_SELECT}>
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-action" className={FILTER_LABEL}>
            Action
          </label>
          <select id="audit-action" name="action" defaultValue={active.action} className={FILTER_SELECT}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-user" className={FILTER_LABEL}>
            Employee
          </label>
          <select id="audit-user" name="user" defaultValue={active.userId} className={FILTER_SELECT}>
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="audit-from" className={FILTER_LABEL}>
            From
          </label>
          <input
            id="audit-from"
            name="from"
            type="date"
            defaultValue={active.from}
            className={FILTER_SELECT}
          />
        </div>
        <div>
          <label htmlFor="audit-to" className={FILTER_LABEL}>
            To
          </label>
          <input id="audit-to" name="to" type="date" defaultValue={active.to} className={FILTER_SELECT} />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Apply filters
          </button>
          <a
            href="/audit-log"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </a>
        </div>
      </div>
    </form>
  );
}

/** The result table, with an expandable before/after diff per row. */
function AuditRows({
  rows,
  expanded,
  setExpanded,
}: {
  rows: AuditLogRow[];
  expanded: Record<string, boolean>;
  setExpanded: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        No audit entries match these filters.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <ul className="divide-y divide-slate-200">
        {rows.map((row) => {
          const diffs = diffOf(row);
          const isOpen = expanded[row.id] === true;
          return (
            <li key={row.id}>
              <div className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="w-44 shrink-0">
                  <p className="text-xs tabular-nums text-slate-500">
                    {fmtDateTime(row.createdAt)}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-800">
                    {row.actor ?? "System"}
                  </p>
                </div>

                <div className="min-w-[200px] flex-1">
                  <p className="text-sm font-semibold text-slate-900">{row.actionLabel}</p>
                  <p className="text-sm text-slate-600">{row.summary}</p>
                  {(row.entity || row.entityId) && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      {row.entity}
                      {row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ""}
                    </p>
                  )}
                </div>

                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {row.module}
                </span>

                {diffs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !isOpen }))}
                    aria-expanded={isOpen}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {diffs.length} change{diffs.length === 1 ? "" : "s"}
                  </button>
                )}
              </div>

              {isOpen && diffs.length > 0 && (
                <dl className="space-y-1 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs">
                  {diffs.map((d) => {
                    const arrow = d.indexOf(" → ");
                    return (
                      <div key={d} className="flex flex-wrap gap-2">
                        <dt className="min-w-[120px] font-semibold text-slate-600">
                          {d.slice(0, arrow)}
                        </dt>
                        <dd className="flex-1 font-mono text-slate-700">
                          {d.slice(arrow + 3)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
