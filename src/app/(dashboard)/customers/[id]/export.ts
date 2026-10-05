import type { StatementEntry } from "../actions";
import { formatDate, type FormatSettings } from "@/lib/format";

/**
 * Phase 6 — statement CSV export.
 *
 * Rendered server-side into a `data:` URL so the download needs no round-trip
 * and no client-side blob handling. The rows are the SAME ledger entries the
 * page renders, and the money column carries the RAW number rather than a
 * formatted string: a bookkeeper opening this in a spreadsheet needs to sum the
 * column, and "₱1,234.56" is not a number. The currency is stated once in a
 * header row instead.
 *
 * The running-balance column is exported too, because a statement you cannot
 * reconcile line by line is just a list.
 */

type ExportInput = {
  customer: { name: string; id: string };
  entries: StatementEntry[];
  format: FormatSettings;
};

/** Quote a CSV cell, doubling any embedded quotes. */
function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exportStatementCsv({
  customer,
  entries,
  format,
}: ExportInput): string {
  // The customer is named in the export so a detached CSV still says whose
  // statement it is — a column of numbers on its own is not a statement.
  const header = [
    `Statement — ${customer.name}`,
    "",
    "",
    "",
    "",
    `Currency (${format.currencyCode})`,
  ];

  const rows = entries.map((e) =>
    [
      formatDate(e.date, format),
      e.kind,
      `${e.label}${e.detail ? ` — ${e.detail}` : ""}`,
      // Raw number, two decimals, sign preserved: this column must sum.
      e.amount.toFixed(2),
      e.balance.toFixed(2),
      "",
    ]
      .map((v) => cell(v))
      .join(","),
  );

  const csv = [
    header.map(cell).join(","),
    `"Date","Type","Detail","Amount","Balance","Currency (${format.currencyCode})"`,
    ...rows,
  ].join("\r\n");
  // `encodeURIComponent` rather than `base64` so the payload stays readable in
  // devtools, which makes an export failure diagnosable.
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}