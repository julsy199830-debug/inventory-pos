/**
 * CSV / SpreadsheetML helpers shared by every export in the app (Phase 1e).
 *
 * One parser and one writer, so a file this module produces is always readable
 * by `parseCsv` — that round-trip is what lets the inventory export feed the
 * bulk importer. The SpreadsheetML writer exists so an `.xls` export needs no
 * extra dependency: Excel opens the XML workbook natively.
 */

/** A single cell. Numbers stay numbers so SpreadsheetML can type them. */
export type CsvCell = string | number | null | undefined;

/** A parsed CSV: trimmed headers plus rows padded to the header width. */
export type ParsedCsv = { headers: string[]; rows: string[][] };

function escapeCell(value: CsvCell): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: CsvCell[], rows: CsvCell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return lines.join("\r\n");
}

export function downloadCsv(
  filename: string,
  headers: CsvCell[],
  rows: CsvCell[][],
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([`\uFEFF${toCsv(headers, rows)}`], {
    type: "text/csv;charset=utf-8",
  });
  triggerDownload(blob, filename);
}

/** Shared blob -> anchor -> click -> cleanup, with the object URL always revoked. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * XML-escape a value for embedding in SpreadsheetML text.
 *
 * `&` must be replaced first, otherwise the ampersands introduced by the later
 * replacements get double-escaped. Control characters that are illegal in XML
 * 1.0 are stripped rather than escaped, because there is no legal escape for
 * them and Excel refuses to open a document containing them.
 *
 * The control-character class is written with the  ESCAPE on purpose.
 * A literal NUL byte in this file happens to behave identically at runtime, but
 * it makes git treat the whole module as binary, which silently disables diffs,
 * code review and merges for it.
 */
function escapeXml(value: CsvCell): string {
  const text = value == null ? "" : String(value);
  return text
    .replace(/[\u0000-\b\f\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function toSpreadsheetXml(headers: CsvCell[], rows: CsvCell[][]): string {
  const cell = (value: CsvCell) =>
    `<Cell><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`;
  const headerCells = headers.map((h) => cell(h)).join("");
  const bodyRows = rows.map((row) => `<Row>${row.map(cell).join("")}</Row>`).join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/></Style>
 </Styles>
 <Worksheet ss:Name="Export">
  <Table>
   <Row>${headerCells}</Row>
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

export function downloadSpreadsheet(
  filename: string,
  headers: CsvCell[],
  rows: CsvCell[][],
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([toSpreadsheetXml(headers, rows)], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  triggerDownload(blob, filename);
}

export function downloadText(
  filename: string,
  text: string,
  mime = "text/csv;charset=utf-8",
): void {
  if (typeof document === "undefined") return;
  // Prefixed with a BOM so Excel opens peso glyphs correctly, matching
  // `downloadCsv`.
  const blob = new Blob([`\uFEFF${text}`], { type: mime });
  triggerDownload(blob, filename);
}

export function parseCsv(text: string): ParsedCsv | null {
  // Strip a UTF-8 BOM: a file saved by Excel carries one, and without this the
  // first header would read as a mangled "SKU" and never match.
  const input = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) return null;

  const headers = nonEmpty[0].map((h) => h.trim());
  const width = headers.length;
  const rows = nonEmpty.slice(1).map((r) => {
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push("");
    return padded;
  });
  return { headers, rows };
}