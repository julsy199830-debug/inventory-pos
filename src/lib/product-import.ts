/**
 * Bulk product import — the pure planning layer (Phase 1e).
 *
 * ## Why this is split from the write
 *
 * A bulk import is the most dangerous action in the inventory module: one
 * malformed file can touch every product row. The safe shape is therefore three
 * explicit stages, and this file owns the first two:
 *
 *   1. {@link parseProductImport}  — text → typed rows, with per-row errors
 *   2. {@link buildImportPlan}     — rows + current DB state → a classified plan
 *   3. `applyProductImport`        — the plan → one transaction (in the action)
 *
 * Stages 1 and 2 are pure functions over plain data, so they are exhaustively
 * unit-testable with no database, and the UI can render a full preview without
 * touching production data. Nothing is written until an administrator confirms a
 * plan they have already seen.
 *
 * ## The identity rule
 *
 * `Product.sku` is the only unique business key in the schema — there is no
 * barcode column, and `id` is a server-generated UUID no spreadsheet contains.
 * So the importer keys entirely on `sku`:
 *
 *   - unknown `sku`                  → CREATE
 *   - known `sku` with differences   → UPDATE
 *   - known `sku` that matches       → SKIP (no no-op writes)
 *   - anything invalid               → ERROR (blocks the whole batch)
 *
 * A duplicate `sku` *within the file* is always an error, never a silent
 * last-wins overwrite: two rows claiming the same barcode is exactly the
 * accidental conflict the import exists to prevent.
 */
import { parseCsv, toCsv } from "./csv";

/** The columns the import understands, in the order the template emits them. */
export const PRODUCT_IMPORT_COLUMNS = [
  "SKU",
  "Name",
  "Retail Price",
  "Cost Price",
  "Stock",
  "Category",
  "Supplier",
  // Accepted and exported so a round-trip file parses, but NOT written:
  // `Product` has no threshold column. The low-stock cutoff lives on the CATEGORY
  // (`Category.lowStockThreshold`) with an app-wide fallback, so there is no
  // per-product value for an import to set. Thresholds are managed on the
  // categories page; see `buildImportPlan` for why it is not diffed either.
  "Low Stock Threshold",
] as const;

/**
 * Headers we accept as aliases, so a file produced by a different tool still
 * maps. Normalisation (lowercase, `_`/`-` → space) happens at lookup time.
 */
const HEADER_ALIASES: Record<string, string> = {
  sku: "SKU",
  "product code": "SKU",
  barcode: "SKU",
  name: "Name",
  "product name": "Name",
  description: "Name",
  "retail price": "Retail Price",
  price: "Retail Price",
  sellingprice: "Retail Price",
  "cost price": "Cost Price",
  cost: "Cost Price",
  stock: "Stock",
  quantity: "Stock",
  onhand: "Stock",
  category: "Category",
  supplier: "Supplier",
  vendor: "Supplier",
  "low stock threshold": "Low Stock Threshold",
  threshold: "Low Stock Threshold",
  reorderlevel: "Low Stock Threshold",
};

/** A single product row as read from the uploaded file, after coercion. */
export type ImportRow = {
  /** 1-based position in the data rows (header excluded), for error messages. */
  line: number;
  sku: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  /** Category name, or empty to leave uncategorized on create. */
  category: string;
  supplier: string;
  /** Optional per-product low-stock threshold; null means "leave as is". */
  threshold: number | null;
  /** Everything wrong with this row. Non-empty makes it an ERROR row. */
  errors: string[];
};

/** The outcome class for one row of the plan. */
export type ImportKind = "CREATE" | "UPDATE" | "SKIP" | "ERROR";

/** One row of the rendered preview. */
export type ImportPlanRow = {
  line: number;
  kind: ImportKind;
  sku: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  category: string;
  supplier: string;
  /** Human list of what will change, for an UPDATE row. */
  changes: string[];
  /** Populated for ERROR rows. */
  errors: string[];
};

/** A full preview: the per-row plan plus the summary counts. */
export type ImportPlan = {
  rows: ImportPlanRow[];
  creates: number;
  updates: number;
  skips: number;
  errors: number;
  /**
   * True when the batch is clean AND there is something to write. The write step
   * refuses unless this is set, so one bad row can never half-apply a batch.
   */
  canApply: boolean;
};

/** What the importer knows about the current catalog, keyed by SKU. */
export type ExistingProduct = {
  sku: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  categoryName: string | null;
  supplierName: string | null;
  /** Effective low-stock cutoff: the category's override, else the app-wide
   *  default. Carried for display/export only — it is a category-level setting,
   *  not a per-product column, so the import never writes it. */
  threshold: number;
};

/**
 * Coerce a cell to a number, tolerating currency symbols, thousands separators
 * and stray spaces — all of which spreadsheets introduce silently when a column
 * is formatted as money or a value is pasted from another sheet.
 *
 * Returns NaN for anything unparseable, which the caller turns into a per-row
 * error. Deliberately strict otherwise: "1299" in a peso column means either
 * ₱1,299 or a missing decimal, and guessing is worse than asking.
 */
/**
 * A leading currency symbol: `$1,299.50`, `₱1299.50`, `€1 299,50`.
 *
 * Matched by the Unicode `Sc` (Symbol, currency) property rather than a hand-
 * kept list, so every currency a spreadsheet might emit — peso, euro, yen,
 * rupee — is accepted without a code change, and ordinary words still fail.
 */
const CURRENCY = /^\p{Sc}\s*/u;
/** Thousands separators and whitespace: "$1,234.56" is a number, "1 234" is too. */
const SEPARATORS = /[\s,]/g;

/**
 * Parse a spreadsheet number cell.
 *
 * Deliberately tolerant of real-world formatting (currency symbols, thousands
 * separators, whitespace) but NOT of stray text: an earlier version stripped
 * every non-numeric character, which silently turned "12abc" into 12 and
 * "1-2" into 12. Anything that is not already number-shaped after the
 * formatting is removed is NaN, so a typo becomes a visible row error instead
 * of a plausible-looking wrong value written to the catalog.
 */
function parseNumber(raw: string): number {
  const cleaned = raw
    .trim()
    .replace(CURRENCY, "")
    .replace(SEPARATORS, "");
  if (!/^[+-]?\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

/** Round to cents, so float noise never shows as a spurious "price changed". */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parse a raw CSV into typed rows, recording per-row problems instead of
 * throwing.
 *
 * Validation is per-row AND total: a file whose row 3 has a bad price still
 * yields rows 1, 2 and 4, so the preview can show the operator everything wrong
 * at once rather than making them fix one error per round-trip.
 */
export function parseProductImport(csv: string): ImportRow[] {
  const parsed = parseCsv(csv);
  if (!parsed) return [];

  // Map the file's header names onto our canonical column names.
  const index = new Map<string, number>();
  parsed.headers.forEach((header, i) => {
    const canonical =
      HEADER_ALIASES[header.trim().toLowerCase().replace(/[_-]/g, " ")];
    if (canonical && !index.has(canonical)) index.set(canonical, i);
  });

  // A file missing SKU or Name cannot be processed at all, so that is reported
  // once (as a single ERROR row at line 0) instead of on every data row.
  const missing = ["SKU", "Name"].filter((c) => !index.has(c));
  if (missing.length > 0) {
    return [
      {
        line: 0,
        sku: "",
        name: "",
        price: 0,
        cost: 0,
        stock: 0,
        category: "",
        supplier: "",
        threshold: null,
        errors: [
          `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(
            ", ",
          )}. Expected headers: ${PRODUCT_IMPORT_COLUMNS.join(", ")}.`,
        ],
      },
    ];
  }

  const at = (row: string[], column: string): string => {
    const i = index.get(column);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const seenSkus = new Map<string, number>();
  const rows: ImportRow[] = [];

  parsed.rows.forEach((raw, i) => {
    const line = i + 1;
    const errors: string[] = [];
    const sku = at(raw, "SKU").toUpperCase();
    const name = at(raw, "Name");

    if (!sku) errors.push("SKU is required.");
    if (!name) errors.push("Name is required.");

    // A duplicate inside the file is always fatal for the row. Reported on the
    // SECOND occurrence, so the first row still reads as valid.
    if (sku) {
      const first = seenSkus.get(sku);
      if (first !== undefined) {
        errors.push(`Duplicate SKU in this file (first seen on row ${first}).`);
      } else {
        seenSkus.set(sku, line);
      }
    }

    const price = parseNumber(at(raw, "Retail Price"));
    const cost = parseNumber(at(raw, "Cost Price"));
    const stock = parseNumber(at(raw, "Stock"));
    const thresholdRaw = at(raw, "Low Stock Threshold");
    const threshold = thresholdRaw ? parseNumber(thresholdRaw) : null;

    if (!Number.isFinite(price) || price < 0) {
      errors.push("Retail price must be a number of 0 or more.");
    }
    if (!Number.isFinite(cost) || cost < 0) {
      errors.push("Cost price must be a number of 0 or more.");
    }
    if (!Number.isInteger(stock) || stock < 0) {
      errors.push("Stock must be a whole number of 0 or more.");
    }
    if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0)) {
      errors.push("Low stock threshold must be a whole number of 0 or more.");
    }

    rows.push({
      line,
      sku,
      name,
      price: Number.isFinite(price) ? price : 0,
      cost: Number.isFinite(cost) ? cost : 0,
      stock: Number.isInteger(stock) ? stock : 0,
      category: at(raw, "Category"),
      supplier: at(raw, "Supplier"),
      threshold,
      errors,
    });
  });

  return rows;
}

/**
 * Turn parsed rows + the current catalog into a classified, renderable plan.
 *
 * Pure: no I/O, no clock, no randomness, so the same input always produces the
 * same plan and the preview the operator approves is exactly the plan the write
 * step executes.
 *
 * Comparison is deliberately scoped to the fields this importer owns, and uses
 * cent-rounded money so float noise can never present as "price changed".
 */
/**
 * Category and supplier names that actually exist.
 *
 * A row naming a category or supplier that is not in here is an ERROR, not a
 * silent no-op. Previously an unknown name produced a "category: X → Y" change
 * and then resolved to `null` at apply time, so the preview promised a change
 * the import silently did not make (and, worse, would have cleared the existing
 * relation). A blank cell is still "leave alone"; a misspelled name is an error.
 */
export interface ImportVocabulary {
  categories: string[];
  suppliers: string[];
}

export function buildImportPlan(
  rows: ImportRow[],
  existing: Map<string, ExistingProduct>,
  vocabulary?: ImportVocabulary,
): ImportPlan {
  const planRows: ImportPlanRow[] = rows.map((row) => {
    const base = {
      line: row.line,
      sku: row.sku,
      name: row.name,
      price: row.price,
      cost: row.cost,
      stock: row.stock,
      category: row.category,
      supplier: row.supplier,
    };

    if (row.errors.length > 0) {
      return { ...base, kind: "ERROR" as const, changes: [], errors: row.errors };
    }

    // An unrecognised category/supplier name is a row error. Checked before the
    // create/update split so it fails identically for new and existing SKUs.
    // Case-insensitive, matching how the relation lookup itself compares.
    if (vocabulary) {
      const unknown: string[] = [];
      const known = (list: string[], name: string) =>
        list.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());
      if (row.category && !known(vocabulary.categories, row.category)) {
        unknown.push(`Unknown category "${row.category}".`);
      }
      if (row.supplier && !known(vocabulary.suppliers, row.supplier)) {
        unknown.push(`Unknown supplier "${row.supplier}".`);
      }
      if (unknown.length > 0) {
        return { ...base, kind: "ERROR" as const, changes: [], errors: unknown };
      }
    }

    const current = existing.get(row.sku);
    if (!current) {
      return { ...base, kind: "CREATE" as const, changes: [], errors: [] };
    }

    const changes: string[] = [];
    if (current.name !== row.name) {
      changes.push(`name: ${current.name} → ${row.name}`);
    }
    if (round2(current.price) !== round2(row.price)) {
      changes.push(`price: ${round2(current.price)} → ${round2(row.price)}`);
    }
    if (round2(current.cost) !== round2(row.cost)) {
      changes.push(`cost: ${round2(current.cost)} → ${round2(row.cost)}`);
    }
    if (current.stock !== row.stock) {
      changes.push(`stock: ${current.stock} → ${row.stock}`);
    }
    // Blank category/supplier in the file means "leave alone", never "clear" —
    // an export that simply omits the column must not wipe every product's
    // category.
    if (row.category && (current.categoryName ?? "") !== row.category) {
      changes.push(
        `category: ${current.categoryName ?? "Uncategorized"} → ${row.category}`,
      );
    }
    if (row.supplier && (current.supplierName ?? "") !== row.supplier) {
      changes.push(`supplier: ${current.supplierName ?? "None"} → ${row.supplier}`);
    }
    // DELIBERATELY NOT COMPARED: `Low Stock Threshold`.
    //
    // `Product` has no threshold column — the low-stock cutoff is a CATEGORY
    // setting (`Category.lowStockThreshold`) with an app-wide fallback. So there
    // is no per-product value for a file to change, and the apply step does not
    // write one. Listing a "threshold change" the import would not actually apply
    // is worse than not listing it: the operator would see a diff and expect an
    // effect that never happens. The column is still ACCEPTED and exported so a
    // round-trip file parses cleanly; thresholds are managed on the categories
    // page. See `PRODUCT_IMPORT_COLUMNS` for the full statement.

    return {
      ...base,
      kind: changes.length === 0 ? ("SKIP" as const) : ("UPDATE" as const),
      changes,
      errors: [],
    };
  });

  const counts = { CREATE: 0, UPDATE: 0, SKIP: 0, ERROR: 0 };
  for (const r of planRows) counts[r.kind] += 1;

  return {
    rows: planRows,
    creates: counts.CREATE,
    updates: counts.UPDATE,
    skips: counts.SKIP,
    errors: counts.ERROR,
    // SKIP rows are not applied, so an all-skip file has nothing to write. That
    // is reported as "nothing to do" rather than a misleading success.
    canApply: counts.CREATE + counts.UPDATE > 0 && counts.ERROR === 0,
  };
}

/**
 * The downloadable import template: canonical headers plus one worked example
 * row, so an operator can see the expected shape without guessing.
 */
export function productImportTemplateCsv(): string {
  return toCsv(
    [...PRODUCT_IMPORT_COLUMNS],
    [
      [
        "ELEC-0001",
        "Aurora Wireless Headphones",
        "129.99",
        "60.00",
        "42",
        "Electronics",
        "Metro Wholesale",
        "10",
      ],
    ],
  );
}

/**
 * The full catalog as a round-trippable CSV — the same columns the importer
 * reads, so an operator can export, edit in a spreadsheet, and re-import.
 */
export function productExportCsv(products: ExistingProduct[]): string {
  return toCsv(
    [...PRODUCT_IMPORT_COLUMNS],
    products.map((p) => [
      p.sku,
      p.name,
      String(round2(p.price)),
      String(round2(p.cost)),
      String(p.stock),
      p.categoryName ?? "",
      p.supplierName ?? "",
      String(p.threshold),
    ]),
  );
}

