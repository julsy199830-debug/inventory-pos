/**
 * Unit tests for the Phase 1e pure logic: audit diffing/formatting, the CSV
 * round-trip, and the bulk-import plan builder.
 *
 * These are the parts that decide what an administrator sees and what a bulk
 * import will do to the catalog, so they are tested directly with no database at
 * all. The import tests pin the properties that make a bulk write safe:
 *
 *   - a file with ANY bad row can never be applied (`canApply` stays false)
 *   - a duplicate SKU inside one file is always an error, never last-wins
 *   - unchanged rows are SKIPped rather than written
 *   - a blank category/supplier means "leave alone", never "clear"
 *   - the template round-trips through the parser
 *
 * Run: npx tsx tests/unit/phase1e-rules.test.ts
 */
import assert from "node:assert/strict";
import {
  changedFields,
  formatAuditValue,
} from "@/lib/audit-format";
import {
  ACTION_MODULES,
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_MODULES,
  AUDIT_MODULE_LABELS,
} from "@/lib/audit";
import { parseCsv, toCsv, toSpreadsheetXml } from "@/lib/csv";
import {
  buildImportPlan,
  parseProductImport,
  productExportCsv,
  productImportTemplateCsv,
  type ExistingProduct,
} from "@/lib/product-import";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── Audit vocabulary integrity ─────────────────────────────────────────────
check("every action has a module, and it is a real module", () => {
  for (const action of AUDIT_ACTIONS) {
    assert.ok(ACTION_MODULES[action], `${action} has no module mapping`);
    assert.ok(
      (AUDIT_MODULES as readonly string[]).includes(ACTION_MODULES[action]),
      `${action} maps to unknown module ${ACTION_MODULES[action]}`,
    );
  }
});
check("every action and every module has a human label", () => {
  for (const action of AUDIT_ACTIONS) {
    assert.ok(AUDIT_ACTION_LABELS[action], `${action} has no label`);
  }
  // `mod`, not `module`: the next lint rule forbids shadowing the CommonJS global.
  for (const mod of AUDIT_MODULES) {
    assert.ok(AUDIT_MODULE_LABELS[mod], `${mod} has no label`);
  }
});
check("the action and label sets cannot drift apart", () => {
  assert.deepEqual(
    Object.keys(AUDIT_ACTION_LABELS).sort(),
    [...AUDIT_ACTIONS].sort(),
    "a label exists with no matching action, or an action with no label",
  );
});

// ── Audit diffing ──────────────────────────────────────────────────────────
check("changedFields reports only fields whose value actually changed", () => {
  const diff = changedFields(
    { name: "A", price: 10, stock: 5 },
    { name: "A", price: 12, stock: 5 },
  );
  assert.equal(diff.length, 1);
  assert.equal(diff[0].field, "price");
  assert.equal(diff[0].from, 10);
  assert.equal(diff[0].to, 12);
});
check("changedFields is sorted, so a diff does not reshuffle between renders", () => {
  const diff = changedFields({ z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 });
  assert.deepEqual(diff.map((d) => d.field), ["a", "m", "z"]);
});
check("changedFields treats a key present on one side only as a change", () => {
  const added = changedFields({}, { stock: 4 });
  assert.equal(added.length, 1);
  assert.equal(added[0].from, undefined);
  assert.equal(added[0].to, 4);
  const removed = changedFields({ stock: 4 }, {});
  assert.equal(removed.length, 1);
  assert.equal(removed[0].to, undefined);
});
check("changedFields on two nulls is empty, not a crash", () => {
  assert.deepEqual(changedFields(null, null), []);
  assert.deepEqual(changedFields(undefined, undefined), []);
});
check("changedFields distinguishes 0 from false and from empty string", () => {
  assert.equal(changedFields({ a: 0 }, { a: false }).length, 1);
  assert.equal(changedFields({ a: 0 }, { a: "" }).length, 1);
  assert.equal(changedFields({ a: 0 }, { a: 0 }).length, 0);
});

// ── Audit value formatting ─────────────────────────────────────────────────
check("formatAuditValue renders empties, booleans and numbers distinctly", () => {
  assert.equal(formatAuditValue(null), "—");
  assert.equal(formatAuditValue(undefined), "—");
  assert.equal(formatAuditValue(""), "—");
  assert.equal(formatAuditValue(true), "Yes");
  assert.equal(formatAuditValue(false), "No");
  assert.equal(formatAuditValue(0), "0");
  assert.equal(formatAuditValue(129.99), "129.99");
});
check("formatAuditValue renders a stored ISO timestamp readably", () => {
  const out = formatAuditValue("2026-09-29T08:30:00.000Z");
  assert.notEqual(out, "2026-09-29T08:30:00.000Z", "should not dump the raw ISO string");
  assert.ok(out.includes("2026"), `expected a rendered date, got ${out}`);
});
check("formatAuditValue does not mistake an SKU for a date", () => {
  assert.equal(formatAuditValue("2024-01"), "2024-01");
  assert.equal(formatAuditValue("ELEC-0001"), "ELEC-0001");
});

// ── CSV round-trip ─────────────────────────────────────────────────────────
check("parseCsv handles quoted fields containing commas", () => {
  const parsed = parseCsv('SKU,Name\nA-1,"Widget, large"\n');
  assert.deepEqual(parsed?.headers, ["SKU", "Name"]);
  assert.deepEqual(parsed?.rows, [["A-1", "Widget, large"]]);
});
check("parseCsv handles doubled quotes and embedded newlines", () => {
  const parsed = parseCsv('A,B\n"say ""hi""","two\nlines"\n');
  assert.deepEqual(parsed?.rows, [[`say "hi"`, "two\nlines"]]);
});
check("parseCsv strips a UTF-8 BOM so the first header still matches", () => {
  const parsed = parseCsv("﻿SKU,Name\nA-1,Widget\n");
  assert.deepEqual(parsed?.headers, ["SKU", "Name"], "BOM must not corrupt the first header");
});
check("parseCsv pads short rows to the header width", () => {
  const parsed = parseCsv("A,B,C\n1,2\n");
  assert.deepEqual(parsed?.rows, [["1", "2", ""]]);
});
check("parseCsv drops entirely blank lines", () => {
  const parsed = parseCsv("A,B\n1,2\n\n3,4\n");
  assert.equal(parsed?.rows.length, 2);
});
check("parseCsv returns null for empty input rather than throwing", () => {
  assert.equal(parseCsv(""), null);
  assert.equal(parseCsv("\n\n"), null);
});
check("toCsv escapes values that would otherwise break the file", () => {
  const csv = toCsv(["A", "B"], [["x,y", 'say "hi"']]);
  assert.ok(csv.includes('"x,y"'));
  assert.ok(csv.includes('"say ""hi"""'));
});
check("toSpreadsheetXml types numeric cells as numbers and text as strings", () => {
  const xml = toSpreadsheetXml(["Total", "Note"], [[42.5, "hello"]]);
  assert.ok(xml.includes('<Data ss:Type="Number">42.5</Data>'));
  assert.ok(xml.includes('<Data ss:Type="String">hello</Data>'));
});
check("toSpreadsheetXml escapes markup so the document stays valid", () => {
  const xml = toSpreadsheetXml(["A"], [["<b>&</b>"]]);
  assert.ok(xml.includes("&lt;b&gt;&amp;&lt;/b&gt;"), `markup not escaped: ${xml}`);
  assert.ok(!xml.includes("<b>"), "raw markup leaked into the document");
});

// ── Product import: parsing and validation ─────────────────────────────────
const HEADER = "SKU,Name,Retail Price,Cost Price,Stock,Category,Supplier,Low Stock Threshold";

check("a well-formed file parses into typed rows", () => {
  const rows = parseProductImport(`${HEADER}\nELEC-0001,Widget,129.99,60.00,42,Electronics,Metro,10\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "ELEC-0001");
  assert.equal(rows[0].price, 129.99);
  assert.equal(rows[0].stock, 42);
  assert.equal(rows[0].threshold, 10);
  assert.deepEqual(rows[0].errors, [], "a valid row must have no errors");
});
check("a missing required column is reported once, not per row", () => {
  const rows = parseProductImport("SKU,Retail Price\nELEC-0001,10\nELEC-0002,20\n");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].errors[0].includes("Name"), `expected a Name complaint, got ${rows[0].errors}`);
});
check("a duplicate SKU inside one file is an error, never last-wins", () => {
  const rows = parseProductImport(
    `${HEADER}\nA-1,First,10,5,1,Cat,Supp,10\nA-1,Second,20,5,1,Cat,Supp,10\n`,
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].errors, [], "the first occurrence is valid");
  assert.ok(rows[1].errors.some((e) => e.includes("Duplicate SKU")), "the second must be an error");
  assert.ok(rows[1].errors.some((e) => e.includes("row 1")), "the error names the first row");
});
check("SKUs are uppercased so identity matching is case-insensitive", () => {
  const rows = parseProductImport(`${HEADER}\nelec-0001,Widget,10,5,1,Cat,Supp,10\n`);
  assert.equal(rows[0].sku, "ELEC-0001");
});
check("non-numeric prices and fractional stock are rejected per row", () => {
  const rows = parseProductImport(`${HEADER}\nA-1,Widget,abc,5,1,Cat,Supp,10\nA-2,Gadget,10,5,1.5,Cat,Supp,10\n`);
  assert.ok(rows[0].errors.some((e) => e.includes("Retail price")));
  assert.ok(rows[1].errors.some((e) => e.includes("Stock must be a whole number")));
});
check("negative values are rejected", () => {
  const rows = parseProductImport(`${HEADER}\nA-1,Widget,-5,5,1,Cat,Supp,10\n`);
  assert.ok(rows[0].errors.some((e) => e.includes("Retail price")));
});
check("a blank or zero price is accepted (free products are legal)", () => {
  const rows = parseProductImport(`${HEADER}\nA-1,Free,0,0,0,Cat,Supp,10\n`);
  assert.deepEqual(rows[0].errors, []);
});
check("currency symbols and thousands separators in a cell are tolerated", () => {
  const rows = parseProductImport(`${HEADER}\nA-1,Widget,"₱1,299.50",60,5,Cat,Supp,10\n`);
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].price, 1299.5);
});
check("an omitted threshold is null, meaning 'leave as is'", () => {
  const rows = parseProductImport("SKU,Name,Retail Price,Cost Price,Stock\nA-1,Widget,10,5,1\n");
  assert.equal(rows[0].threshold, null);
});
check("malformed text is an error, never a stripped-down number", () => {
  // The old parser removed every non-numeric character, so "12abc" became 12
  // and "1-2" became 12 — a typo silently wrote a plausible wrong price.
  for (const bad of ["12abc", "1-2", "1.2.3", "abc", "..", "--5", "1e", "N/A"]) {
    const rows = parseProductImport(`${HEADER}\nA-1,Widget,${bad},5,1,Cat,Supp,10\n`);
    assert.equal(
      rows[0].errors.length,
      1,
      `"${bad}" should be rejected, got ${JSON.stringify(rows[0])}`,
    );
  }
});
check("a leading + or a negative value still parses", () => {
  assert.equal(parseProductImport(`${HEADER}\nA-1,W,+12.50,5,1,Cat,Supp,10\n`)[0].price, 12.5);
  assert.equal(parseProductImport(`${HEADER}\nA-1,W,-3,5,1,Cat,Supp,10\n`)[0].errors.length, 1);
});
check("one bad row does not hide the good ones", () => {
  const rows = parseProductImport(
    `${HEADER}\nA-1,Good,10,5,1,Cat,Supp,10\nA-2,Bad,xyz,5,1,Cat,Supp,10\nA-3,AlsoGood,10,5,1,Cat,Supp,10\n`,
  );
  assert.equal(rows.length, 3, "all three rows must be reported, not just the bad one");
  assert.deepEqual(rows[0].errors, []);
  assert.ok(rows[1].errors.length > 0);
  assert.deepEqual(rows[2].errors, []);
});
check("common header aliases map onto the canonical columns", () => {
  const rows = parseProductImport("barcode,product name,price,cost,quantity,vendor\nA-1,Widget,10,5,3,Metro\n");
  assert.deepEqual(rows[0].errors, [], `alias mapping failed: ${rows[0].errors.join("; ")}`);
  assert.equal(rows[0].sku, "A-1");
  assert.equal(rows[0].name, "Widget");
  assert.equal(rows[0].stock, 3);
  assert.equal(rows[0].supplier, "Metro");
});

// ── Product import: the plan builder (the safety-critical part) ───────────
const DEFAULT_THRESHOLD = 10;

/** A minimal existing-catalog entry. */
function existing(over: Partial<ExistingProduct> = {}): ExistingProduct {
  return {
    sku: "ELEC-0001",
    name: "Aurora Wireless Headphones",
    price: 129.99,
    cost: 60,
    stock: 42,
    categoryName: "Electronics",
    supplierName: "Metro Wholesale",
    threshold: DEFAULT_THRESHOLD,
    ...over,
  };
}
const catalog = (...items: ExistingProduct[]) => new Map(items.map((p) => [p.sku, p]));

check("an unknown SKU is a CREATE", () => {
  const rows = parseProductImport(`${HEADER}\nNEW-1,Brand New,10,5,3,Cat,Supp,10\n`);
  const plan = buildImportPlan(rows, catalog(existing()));
  assert.equal(plan.creates, 1);
  assert.equal(plan.rows[0].kind, "CREATE");
  assert.equal(plan.canApply, true);
});
check("a known SKU with a different price is an UPDATE naming the change", () => {
  const rows = parseProductImport(
    `${HEADER}\nELEC-0001,Aurora Wireless Headphones,139.99,60,42,Electronics,Metro Wholesale,10\n`,
  );
  const plan = buildImportPlan(rows, catalog(existing()));
  assert.equal(plan.updates, 1);
  assert.ok(plan.rows[0].changes.some((c) => c.includes("139.99")), plan.rows[0].changes.join("; "));
});
check("an identical row is SKIPped, so no no-op write is issued", () => {
  const rows = parseProductImport(
    `${HEADER}\nELEC-0001,Aurora Wireless Headphones,129.99,60,42,Electronics,Metro Wholesale,10\n`,
  );
  const plan = buildImportPlan(rows, catalog(existing()));
  assert.equal(plan.skips, 1);
  assert.equal(plan.updates, 0);
  assert.deepEqual(plan.rows[0].changes, []);
  // An all-skip file has nothing to write, so it is not "applicable".
  assert.equal(plan.canApply, false, "an all-skip batch must not be reported as importable");
});
check("a blank category means leave-alone, not clear the category", () => {
  const rows = parseProductImport(
    "SKU,Name,Retail Price,Cost Price,Stock\nELEC-0001,Aurora Wireless Headphones,129.99,60,42\n",
  );
  const plan = buildImportPlan(rows, catalog(existing()));
  assert.equal(plan.skips, 1, "a file that omits the column must not wipe every category");
  assert.ok(!plan.rows[0].changes.some((c) => c.startsWith("category")));
});
check("float noise never presents as a price change", () => {
  const rows = parseProductImport(
    `${HEADER}\nELEC-0001,Aurora Wireless Headphones,129.99,60,42,Electronics,Metro Wholesale,10\n`,
  );
  const plan = buildImportPlan(rows, catalog(existing({ price: 129.9900000001 })));
  assert.equal(plan.skips, 1, "a sub-cent difference must not be reported as an update");
});
check("stock 0 in the file is a real change, not a blank", () => {
  const rows = parseProductImport(
    `${HEADER}\nELEC-0001,Aurora Wireless Headphones,129.99,60,0,Electronics,Metro Wholesale,10\n`,
  );
  const plan = buildImportPlan(rows, catalog(existing()));
  assert.equal(plan.updates, 1);
  assert.ok(plan.rows[0].changes.some((c) => c.startsWith("stock: 42 → 0")));
});
check("ANY error row makes the whole batch un-applyable", () => {
  const rows = parseProductImport(
    `${HEADER}\nELEC-0001,Aurora Wireless Headphones,139.99,60,42,Electronics,Metro Wholesale,10\nBAD-1,Broken,xyz,5,1,Cat,Supp,10\n`,
  );
  const plan = buildImportPlan(rows, catalog(existing()));
  assert.equal(plan.errors, 1);
  assert.equal(plan.updates, 1, "the good row is still classified as an update");
  assert.equal(
    plan.canApply,
    false,
    "one bad row must block the entire batch — this is the no-partial-import guarantee",
  );
});
check("counts add up to the number of rows", () => {
  const rows = parseProductImport(
    `${HEADER}\nELEC-0001,Aurora Wireless Headphones,139.99,60,42,Electronics,Metro Wholesale,10\nELEC-0001,Aurora Wireless Headphones,129.99,60,42,Electronics,Metro Wholesale,10\nNEW-1,Brand New,10,5,3,Cat,Supp,10\n`,
  );
  const plan = buildImportPlan(rows, catalog(existing()));
  assert.equal(
    plan.creates + plan.updates + plan.skips + plan.errors,
    plan.rows.length,
    "a row must be classified exactly once",
  );
});
check("the same input always produces the same plan", () => {
  const csv = `${HEADER}\nELEC-0001,Aurora Wireless Headphones,139.99,60,42,Electronics,Metro Wholesale,10\nNEW-1,Brand New,10,5,3,Cat,Supp,10\n`;
  const a = buildImportPlan(parseProductImport(csv), catalog(existing()));
  const b = buildImportPlan(parseProductImport(csv), catalog(existing()));
  assert.deepEqual(a, b, "the preview the operator approves must be the plan that executes");
});

// ── Template / export round-trip ───────────────────────────────────────────
check("the download template parses back into exactly one valid row", () => {
  const rows = parseProductImport(productImportTemplateCsv());
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].errors, [], `template row must be valid: ${rows[0].errors.join("; ")}`);
});
check("a product export round-trips back through the importer as SKIP", () => {
  const items = [
    existing(),
    existing({
      sku: "FOOD-0002",
      name: "Arabica Beans",
      price: 250,
      stock: 5,
      categoryName: "Food/Beverage",
    }),
  ];
  const plan = buildImportPlan(
    parseProductImport(productExportCsv(items)),
    catalog(...items),
  );
  assert.equal(plan.skips, 2, "an exported-then-reimported catalog must be a no-op");
  assert.equal(plan.canApply, false);
});
check("an export with no category or supplier still round-trips", () => {
  const items = [existing({ categoryName: null, supplierName: null })];
  const plan = buildImportPlan(
    parseProductImport(productExportCsv(items)),
    catalog(...items),
  );
  assert.equal(plan.skips, 1, `expected a no-op, got ${JSON.stringify(plan.rows[0])}`);
});
check("a threshold difference is NOT reported as a change", () => {
  // `Product` has no threshold column — the cutoff lives on the CATEGORY. An
  // export therefore carries a value the import cannot write, so diffing it
  // would show an operator a change that never happens and would stop a
  // round-tripped catalog from ever previewing as all-unchanged.
  const items = [existing({ threshold: 25 })];
  const plan = buildImportPlan(
    parseProductImport(productExportCsv(items)),
    catalog(...items),
  );
  assert.equal(plan.skips, 1, "threshold alone must not make a row an UPDATE");
  assert.deepEqual(plan.rows[0].changes, []);
});

console.log(`\nPhase 1e rule tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;


check("an unknown category name is a row error, not a silent no-op", () => {
  // Previously this produced a "category: X -> Y" change that then resolved to
  // null at apply time — a promised change the import never made, which would
  // also have cleared the product's existing category.
  const row = parseProductImport(`${HEADER}\nA-1,Widget,10,5,1,Nonexistent,Supp,10\n`)[0];
  const plan = buildImportPlan([row], catalog(existing()), {
    categories: ["Electronics"],
    suppliers: ["Metro Wholesale"],
  });
  assert.equal(plan.errors, 1);
  assert.equal(plan.canApply, false, "an unknown category must block the whole batch");
  assert.match(plan.rows[0].errors[0], /Unknown category/);
});
check("a known category name differing only in case is accepted", () => {
  const row = parseProductImport(`${HEADER}\nA-1,Widget,10,5,1,electronics,metro wholesale,10\n`)[0];
  const plan = buildImportPlan([row], catalog(), {
    categories: ["Electronics"],
    suppliers: ["Metro Wholesale"],
  });
  assert.equal(plan.errors, 0);
  assert.equal(plan.creates, 1);
});
check("a blank category is still 'leave alone', never an error", () => {
  const row = parseProductImport(`${HEADER}\nA-1,Widget,10,5,1,,,10\n`)[0];
  const plan = buildImportPlan([row], catalog(), { categories: [], suppliers: [] });
  assert.equal(plan.errors, 0);
  assert.equal(plan.creates, 1);
});
