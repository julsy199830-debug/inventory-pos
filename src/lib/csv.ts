/**
 * Minimal CSV building blocks shared by the export buttons (reports,
 * inventory, customer ledger). Pure functions with no framework dependencies
 * so both Server and Client Components can import them.
 *
 * Encoding: fields are RFC-4180 escaped (commas, quotes, newlines quoted;
 * inner quotes doubled) and the download payload is prefixed with a UTF-8 BOM
 * so Excel opens peso/euro glyphs correctly instead of mojibake.
 */

export type CsvCell = string | number | boolean | null | undefined;

/** Escape a single CSV field per RFC 4180 (quote only when necessary). */
function escapeCell(value: CsvCell): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build a CSV document from a header row + data rows. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return lines.join("\r\n");
}

/**
 * Trigger a browser download of `headers`/`rows` as `filename.csv`.
 * Client-side only: a no-op when `document` is unavailable (SSR), so the
 * helper is safe to import from shared modules.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: CsvCell[][],
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([`\uFEFF${toCsv(headers, rows)}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}