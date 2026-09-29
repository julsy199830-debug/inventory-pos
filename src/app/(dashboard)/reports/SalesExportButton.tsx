"use client";

/**
 * The sales export panel (Phase 1e) for `/reports`.
 *
 * Sits next to the existing Z-Report CSV button and shares its filters, so what
 * an administrator exports is what they were looking at.
 *
 * The button is deliberately two-step — a dialog that shows the row count before
 * producing a file. An export is a one-way trip out of the app, and silently
 * dumping 4,000 rows on a mis-set date range is the kind of mistake only
 * noticed after the file is already in someone's inbox.
 */
import { useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Modal } from "@/app/_components/ui/Modal";
import { downloadCsv, downloadSpreadsheet } from "@/lib/csv";
import {
  getSalesExportRows,
  type SalesExportFilters,
  type SalesExportRow,
} from "./actions";

/** Column order. Kept in one place so CSV and Excel can never disagree. */
const HEADERS = [
  "Sale #",
  "Date/Time",
  "Cashier",
  "Customer",
  "Items",
  "Item Count",
  "Subtotal",
  "Discount",
  "Tax",
  "Loyalty Points Redeemed",
  "Loyalty Discount",
  "Refunded",
  "Total",
  "Payment Method",
  "Status",
];

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Project one sale row into the shared column order. */
function toCells(row: SalesExportRow): (string | number)[] {
  return [
    row.id.slice(0, 8).toUpperCase(),
    fmtDateTime(row.createdAt),
    row.cashierName ?? "—",
    row.customerName ?? "Walk-in",
    row.items,
    row.itemCount,
    row.subtotal,
    row.discountAmount,
    row.tax,
    row.redeemedPoints,
    row.redemptionAmount,
    row.refundedAmount,
    row.totalAmount,
    row.paymentMethod.replaceAll("_", " "),
    row.status,
  ];
}

const selectClass =
  "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25";
const labelClass =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

export default function SalesExportButton({
  initialFrom,
  initialTo,
  initialPaymentMethod,
  initialCashierId,
  cashiers,
}: {
  initialFrom: string;
  initialTo: string;
  initialPaymentMethod: string;
  initialCashierId: string;
  cashiers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SalesExportRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [filters, setFilters] = useState<SalesExportFilters>({
    from: initialFrom,
    to: initialTo,
    paymentMethod: initialPaymentMethod,
    cashierId: initialCashierId,
    query: "",
  });

  /** Count the rows first, so the file itself is never a surprise. */
  async function preview() {
    setPending(true);
    setError(null);
    const res = await getSalesExportRows(filters);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows(res.data.rows);
    setTruncated(res.data.truncated);
  }

  function download(kind: "csv" | "xls") {
    if (!rows) return;
    const cells = rows.map(toCells);
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "csv") downloadCsv(`invpos-sales-${stamp}.csv`, HEADERS, cells);
    else downloadSpreadsheet(`invpos-sales-${stamp}.xls`, HEADERS, cells);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setRows(null);
          setError(null);
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white"
      >
        <FileSpreadsheet className="h-4 w-4" />
        Export sales
      </button>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Export sales"
        description="Download the sales ledger as CSV or Excel, filtered to a date range."
        className="max-w-2xl"
        busy={pending}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="export-from" className={labelClass}>
                From
              </label>
              <input
                id="export-from"
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                className={selectClass}
              />
            </div>
            <div>
              <label htmlFor="export-to" className={labelClass}>
                To
              </label>
              <input
                id="export-to"
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                className={selectClass}
              />
            </div>
            <div>
              <label htmlFor="export-method" className={labelClass}>
                Payment method
              </label>
              <select
                id="export-method"
                value={filters.paymentMethod}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, paymentMethod: e.target.value }))
                }
                className={selectClass}
              >
                <option value="">All methods</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="STORE_CREDIT">Store credit</option>
              </select>
            </div>
            <div>
              <label htmlFor="export-cashier" className={labelClass}>
                Cashier
              </label>
              <select
                id="export-cashier"
                value={filters.cashierId}
                onChange={(e) => setFilters((f) => ({ ...f, cashierId: e.target.value }))}
                className={selectClass}
              >
                <option value="">All cashiers</option>
                {cashiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="export-query" className={labelClass}>
                Search
              </label>
              <input
                id="export-query"
                type="search"
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                placeholder="Customer name or sale number…"
                className={selectClass}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={preview}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {rows ? "Refresh preview" : "Preview rows"}
            </button>
            {rows && (
              <p className="text-sm text-slate-600">
                {rows.length.toLocaleString()} sale{rows.length === 1 ? "" : "s"} ready
                {truncated ? " (capped at 5,000 — narrow the date range)" : ""}
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 p-2.5 text-sm text-red-600 ring-1 ring-red-500/30">
              {error}
            </p>
          )}

          {/*
            Guarded on `rows.length`, not just `rows`. An empty array is truthy,
            so `rows &&` would offer a download button for a zero-row export — a
            file that looks like a real result and contains nothing at all.
          */}
          {rows && rows.length > 0 && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => download("csv")}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <Download className="h-4 w-4" /> Download CSV
              </button>
              <button
                type="button"
                onClick={() => download("xls")}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
              >
                <Download className="h-4 w-4" /> Download Excel
              </button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

