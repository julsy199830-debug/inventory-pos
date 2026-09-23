"use client";

import { downloadCsv } from "@/lib/csv";
import type { PaymentBreakdownRow, TopProduct } from "./actions";

/**
 * "Export CSV" button for the daily Sales & Z-Report page (`/reports`).
 *
 * Builds a three-section spreadsheet â€” Summary (headline KPIs), Payment
 * breakdown (per-method count/total), and Top products â€” from the data the
 * Server Component already loaded for the printed report, so the CSV can never
 * disagree with the sheet on screen. Everything is client-side: no extra
 * server round-trip, no new action to guard.
 */
export default function ExportCsvButton({
  isoDate,
  dateLabel,
  summary,
  topProducts,
}: {
  isoDate: string;
  dateLabel: string;
  summary: {
    revenue: number;
    salesCount: number;
    avgOrderValue: number;
    cogs: number;
    netProfit: number;
    paymentBreakdown: PaymentBreakdownRow[];
  } | null;
  topProducts: TopProduct[];
}) {
  function onExport() {
    const rows: (string | number | null)[][] = [];

    // â”€â”€ Section 1: summary KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    rows.push(["Summary", "Date", dateLabel]);
    if (summary) {
      rows.push(["Summary", "Revenue", summary.revenue]);
      rows.push(["Summary", "Transactions", summary.salesCount]);
      rows.push(["Summary", "Avg order value", summary.avgOrderValue]);
      rows.push(["Summary", "Cost of goods sold", summary.cogs]);
      rows.push(["Summary", "Net profit", summary.netProfit]);
    } else {
      rows.push(["Summary", "Error", "No data for this date"]);
    }

    // â”€â”€ Section 2: payment method breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (summary) {
      for (const row of summary.paymentBreakdown) {
        rows.push(["Payments", row.method, `count=${row.count}`, row.total]);
      }
    }

    // â”€â”€ Section 3: top selling products â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    for (const product of topProducts) {
      rows.push([
        "Top products",
        product.name,
        product.sku,
        product.quantitySold,
        product.revenue,
      ]);
    }

    downloadCsv(`invpos-report-${isoDate}.csv`, ["Section", "Field", "Extra", "Value"], rows);
  }

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={summary === null}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg
        className="h-4 w-4"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.8}
        stroke="currentColor"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
        />
      </svg>
      Export CSV
    </button>
  );
}