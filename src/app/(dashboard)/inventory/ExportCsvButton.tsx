"use client";

import { downloadCsv } from "@/lib/csv";

/** One serializable row the Server Component hands over for export. */
export type InventoryExportRow = {
  sku: string;
  name: string;
  categoryName: string | null;
  price: number;
  cost: number;
  stock: number;
  threshold: number;
};

/**
 * "Export CSV" button for the inventory table (`/inventory`).
 *
 * Serializes exactly the rows the server rendered (respecting the active
 * search/category filters, since the page re-renders with the filtered set) â€”
 * SKU, name, category, retail/cost price, stock level, and the product's
 * effective low-stock threshold. Client-side blob download, no server
 * round-trip.
 */
export default function ExportCsvButton({ rows }: { rows: InventoryExportRow[] }) {
  function onExport() {
    downloadCsv(
      "invpos-inventory.csv",
      ["SKU", "Product Name", "Category", "Retail Price", "Cost Price", "Stock", "Low Stock Threshold"],
      rows.map((row) => [
        row.sku,
        row.name,
        row.categoryName ?? "Uncategorized",
        row.price,
        row.cost,
        row.stock,
        row.threshold,
      ]),
    );
  }

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={rows.length === 0}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
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