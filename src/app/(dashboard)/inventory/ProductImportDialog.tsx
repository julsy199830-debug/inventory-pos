"use client";

/**
 * Bulk product import dialog (Phase 1e), for the inventory page.
 *
 * ## The three-step flow is the feature
 *
 *   1. Pick a file (or paste)   → nothing sent to the server
 *   2. Preview                  → server parses + classifies, writes NOTHING
 *   3. Import                   → one transaction, only enabled when clean
 *
 * The preview step is not decoration. An import can touch every product in the
 * shop, so the operator sees the exact counts of new / updated / unchanged /
 * failed, with per-row reasons, before committing. And because the server
 * refuses the whole batch when any row errors, "Import" is disabled in exactly
 * the cases where the write would be rejected — the UI cannot promise something
 * the server will not do.
 *
 * File reading is client-side (`File.text()`), so an untrusted file never
 * touches a multipart handler.
 */
import { useState } from "react";
import { AlertTriangle, Check, Download, FileUp, Loader2, Upload } from "lucide-react";
import { Modal } from "@/app/_components/ui/Modal";
import { downloadText } from "@/lib/csv";
import { productImportTemplateCsv, PRODUCT_IMPORT_COLUMNS } from "@/lib/product-import";
import {
  applyProductImport,
  previewProductImport,
  type ImportPlan,
} from "./import-actions";

const KIND_STYLES: Record<string, string> = {
  CREATE: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30",
  UPDATE: "bg-amber-500/15 text-amber-700 ring-amber-500/30",
  SKIP: "bg-slate-100 text-slate-600 ring-slate-300",
  ERROR: "bg-red-500/15 text-red-700 ring-red-500/30",
};

export default function ProductImportDialog() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function reset() {
    setCsv("");
    setFileName(null);
    setPlan(null);
    setError(null);
    setDone(null);
  }

  async function readFile(file: File) {
    setError(null);
    setPlan(null);
    setDone(null);
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function preview() {
    setPending(true);
    setError(null);
    const res = await previewProductImport(csv);
    setPending(false);
    if (!res.ok) {
      setPlan(null);
      setError(res.error);
      return;
    }
    setPlan(res.data.plan);
  }

  async function runImport() {
    setPending(true);
    setError(null);
    const res = await applyProductImport(csv);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(
      `Imported: ${res.data.created} created, ${res.data.updated} updated, ${res.data.skipped} unchanged.`,
    );
    setPlan(null);
    setCsv("");
    setFileName(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        <FileUp className="h-4 w-4" />
        Import products
      </button>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Bulk import products"
        description="Upload a CSV, review exactly what will change, then import."
        className="max-w-3xl"
        busy={pending}
      >
        <div className="flex flex-col gap-4">
          {/* ── Step 1: the file ─────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">1. Choose a CSV file</p>
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    "invpos-product-import-template.csv",
                    productImportTemplateCsv(),
                  )
                }
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 underline underline-offset-2 transition hover:text-indigo-900"
              >
                <Download className="h-3.5 w-3.5" /> Download template
              </button>
            </div>

            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
              }}
              className="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
            />

            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">
                Or paste CSV rows here
              </summary>
              <textarea
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setPlan(null);
                }}
                rows={5}
                placeholder={`${PRODUCT_IMPORT_COLUMNS.join(",")}\nELEC-0001,Aurora Wireless Headphones,129.99,60.00,42,Electronics,Metro Wholesale,10`}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </details>

            {fileName && <p className="mt-2 text-xs text-slate-500">Loaded: {fileName}</p>}

            <button
              type="button"
              onClick={preview}
              disabled={pending || csv.trim() === ""}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              2. Preview changes
            </button>
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 p-2.5 text-sm text-red-600 ring-1 ring-red-500/30">
              {error}
            </p>
          )}

          {done && (
            <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2.5 text-sm text-emerald-700 ring-1 ring-emerald-500/30">
              <Check className="h-4 w-4" /> {done}
            </p>
          )}

          {plan && (
            <ImportPlanPreview
              plan={plan}
              pending={pending}
              onCancel={() => setOpen(false)}
              onApply={() => void runImport()}
            />
          )}
        </div>
      </Modal>
    </>
  );
}


/** The preview table + the commit button (step 3 of the import flow). */
function ImportPlanPreview({
  plan,
  pending,
  onCancel,
  onApply,
}: {
  plan: ImportPlan;
  pending: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const writeCount = plan.creates + plan.updates;

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-700">3. Review &amp; import</p>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-500/30">
            {plan.creates} new
          </span>
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 ring-1 ring-amber-500/30">
            {plan.updates} updated
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 ring-1 ring-slate-300">
            {plan.skips} unchanged
          </span>
          {plan.errors > 0 && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-700 ring-1 ring-red-500/30">
              {plan.errors} failed
            </span>
          )}
        </div>
      </div>

      {plan.errors > 0 && (
        <p className="flex gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Nothing will be imported while any row has an error — the import is
          all-or-nothing, so a partial write can never happen.
        </p>
      )}

      <div className="max-h-[45vh] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Row</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">SKU</th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Price</th>
              <th className="px-3 py-2 font-semibold">Stock</th>
              <th className="px-3 py-2 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plan.rows.map((row) => (
              <tr key={`${row.line}-${row.sku}`} className="align-top">
                <td className="px-3 py-2 tabular-nums text-slate-400">{row.line}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                      KIND_STYLES[row.kind]
                    }`}
                  >
                    {row.kind}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-slate-700">{row.sku}</td>
                <td className="px-3 py-2 text-slate-700">{row.name}</td>
                <td className="px-3 py-2 tabular-nums text-slate-700">{row.price}</td>
                <td className="px-3 py-2 tabular-nums text-slate-700">{row.stock}</td>
                <td className="px-3 py-2">
                  {row.kind === "ERROR" ? (
                    <ul className="list-disc pl-4 text-red-700">
                      {row.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : row.changes.length > 0 ? (
                    <ul className="list-disc pl-4 text-slate-600">
                      {row.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={pending || !plan.canApply}
          title={
            plan.canApply
              ? undefined
              : plan.errors > 0
                ? "Fix the failed rows first"
                : "Nothing in this file changes anything"
          }
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Import {writeCount} product{writeCount === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}
