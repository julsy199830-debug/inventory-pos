"use server";

/**
 * Bulk product import — the server actions (Phase 1e).
 *
 * Split from the pure planning layer in `@/lib/product-import` on purpose:
 * everything here touches the database, everything there does not. That makes
 * the plan logic exhaustively unit-testable without a DB, and confines the code
 * that can write products to this one file.
 *
 * ## The atomicity guarantee
 *
 * {@link applyProductImport} writes EVERY row inside one `prisma.$transaction`.
 * There is no per-row commit and no "skip the bad ones" path: if row 40 of 200
 * violates a unique SKU, nothing is written at all. A bulk import that
 * half-applies is worse than one that refuses, because the operator then has no
 * way to tell which half landed.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCashier, roleGuardError } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { LOW_STOCK_THRESHOLD, type MutationResult } from "@/lib/types";
import {
  buildImportPlan,
  parseProductImport,
  type ExistingProduct,
  type ImportPlan,
} from "@/lib/product-import";

const STAFF_ROLES = ["ADMIN", "MANAGER"] as const;

async function staffGuardError(): Promise<string | null> {
  return roleGuardError(STAFF_ROLES);
}

/** Cap on a single import batch, so a runaway file cannot exhaust memory. */
const MAX_IMPORT_ROWS = 2000;

/** Re-exported so the client can import the plan type from one place. */
export type { ImportPlan, ImportPlanRow } from "@/lib/product-import";

/** The product fields the importer reads, selected in one place. */
const PRODUCT_FIELDS = {
  id: true,
  sku: true,
  name: true,
  price: true,
  cost: true,
  stock: true,
  category: { select: { name: true } },
  supplier: { select: { name: true } },
} as const;

/**
 * Map raw product rows into the shape {@link buildImportPlan} expects, keyed by
 * uppercase SKU — `createProduct` uppercases on write and the parser
 * normalizes on read, so the two agree on identity.
 */
function toExisting(
  products: {
    sku: string;
    name: string;
    price: number;
    cost: number;
    stock: number;
    category: { name: string } | null;
    supplier: { name: string } | null;
  }[],
): Map<string, ExistingProduct> {
  const map = new Map<string, ExistingProduct>();
  for (const p of products) {
    map.set(p.sku.toUpperCase(), {
      sku: p.sku,
      name: p.name,
      price: p.price,
      cost: p.cost,
      stock: p.stock,
      categoryName: p.category?.name ?? null,
      supplierName: p.supplier?.name ?? null,
      // `Product` has no threshold column: the effective value is the category's
      // or the app-wide default. Only used to decide whether a row is a genuine
      // SKIP; never written back.
      threshold: LOW_STOCK_THRESHOLD,
    });
  }
  return map;
}

/**
 * Parse + classify a CSV without writing anything.
 *
 * This is what the import dialog calls on "Preview": it returns the full plan
 * (new / updated / unchanged / errored, with per-row reasons) so the operator
 * sees exactly what will happen before committing. Read-only by construction —
 * it runs the same planner the write step uses, so the preview cannot drift
 * from what the apply would do.
 */
export async function previewProductImport(
  csv: string,
): Promise<MutationResult<{ plan: ImportPlan }>> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const text = (csv ?? "").trim();
  if (!text) return { ok: false, error: "Choose a CSV file to import." };

  const rows = parseProductImport(text);
  if (rows.length === 0) {
    return { ok: false, error: "That file has no product rows in it." };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `That file has ${rows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`,
    };
  }

  try {
    const [products, categories, suppliers] = await Promise.all([
      prisma.product.findMany({ select: PRODUCT_FIELDS }),
      prisma.category.findMany({ select: { name: true } }),
      prisma.supplier.findMany({ select: { name: true } }),
    ]);
    return {
      ok: true,
      data: {
        plan: buildImportPlan(rows, toExisting(products), {
          categories: categories.map((c) => c.name),
          suppliers: suppliers.map((s) => s.name),
        }),
      },
    };
  } catch {
    return { ok: false, error: "Could not read the current catalog. Please try again." };
  }
}

/** What {@link applyProductImport} did. */
export type ApplyImportResult = {
  created: number;
  updated: number;
  skipped: number;
};

/**
 * Execute a previously-previewed import, in one transaction.
 *
 * Takes the raw CSV again rather than a client-supplied plan: the plan is
 * re-derived here from the database's own state at write time, so a stale — or
 * tampered — preview cannot smuggle in changes the operator never saw.
 *
 * Refuses outright, with nothing written, when the freshly-derived plan has any
 * ERROR row or has nothing to do.
 */
export async function applyProductImport(
  csv: string,
): Promise<MutationResult<ApplyImportResult>> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const text = (csv ?? "").trim();
  if (!text) return { ok: false, error: "Nothing to import." };

  const parsed = parseProductImport(text);
  if (parsed.length === 0) {
    return { ok: false, error: "That file has no product rows in it." };
  }
  if (parsed.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: "That file is too large to import in one batch." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The read and the writes share one transaction so the plan is derived
      // from exactly the state the writes then apply to.
      const [products, categoryList, supplierList] = await Promise.all([
        tx.product.findMany({ select: PRODUCT_FIELDS }),
        tx.category.findMany({ select: { id: true, name: true } }),
        tx.supplier.findMany({ select: { id: true, name: true } }),
      ]);
      const bySku = new Map(products.map((p) => [p.sku.toUpperCase(), p]));
      const plan = buildImportPlan(parsed, toExisting(products), {
        categories: categoryList.map((c) => c.name),
        suppliers: supplierList.map((s) => s.name),
      });

      // Refuse the WHOLE batch if anything is wrong. This is the "never
      // partially import a failed batch" guarantee, enforced at the only point
      // where it can be.
      if (plan.errors > 0) throw new Error("PLAN_HAS_ERRORS");
      if (plan.creates + plan.updates === 0) throw new Error("PLAN_NOTHING_TO_DO");

      // Resolve referenced categories/suppliers by name (case-insensitive),
      // creating nothing: an import must never silently invent a category. By
      // the time we get here the planner has already rejected any name that is
      // not in `categoryList`/`supplierList`, so these lookups always hit.
      const categoryByName = new Map(
        categoryList.map((c) => [c.name.toLowerCase(), c.id]),
      );
      const supplierByName = new Map(
        supplierList.map((s) => [s.name.toLowerCase(), s.id]),
      );

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const row of plan.rows) {
        if (row.kind === "SKIP") {
          skipped += 1;
          continue;
        }

        const categoryId = row.category
          ? (categoryByName.get(row.category.toLowerCase()) ?? null)
          : null;
        const supplierId = row.supplier
          ? (supplierByName.get(row.supplier.toLowerCase()) ?? null)
          : null;

        if (row.kind === "CREATE") {
          // Opening stock is written as a RESTOCK movement, exactly as the
          // manual "Add product" dialog does, so imported stock is auditable in
          // the stock ledger rather than appearing from nowhere.
          const product = await tx.product.create({
            data: {
              sku: row.sku,
              name: row.name,
              price: row.price,
              cost: row.cost,
              stock: row.stock,
              categoryId,
              supplierId,
            },
          });
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              quantityChange: row.stock,
              type: "RESTOCK",
              reason: "Bulk import — opening stock",
            },
          });
          created += 1;
        } else {
          // An UPDATE sets stock absolutely (the file is the source of truth for
          // a full-catalog import) and records the signed delta as an
          // ADJUSTMENT, so a bulk import can never move inventory without a
          // ledger entry.
          const current = bySku.get(row.sku)!;
          await tx.product.update({
            where: { id: current.id },
            data: {
              name: row.name,
              price: row.price,
              cost: row.cost,
              stock: row.stock,
              // A blank cell means "leave alone", matching the plan's diff.
              ...(categoryId !== null ? { categoryId } : {}),
              ...(supplierId !== null ? { supplierId } : {}),
            },
          });
          const delta = row.stock - current.stock;
          if (delta !== 0) {
            await tx.stockMovement.create({
              data: {
                productId: current.id,
                quantityChange: delta,
                type: "ADJUSTMENT",
                reason: "Bulk import",
              },
            });
          }
          updated += 1;
        }
      }

      return { created, updated, skipped };
    });

    revalidatePath("/inventory");
    revalidatePath("/pos");
    revalidatePath("/");

    // One audit row for the whole batch, not one per product: a 500-row import
    // must not bury the rest of the log, and the batch is the unit the operator
    // actually performed.
    const actor = await getCashier();
    await recordAudit({
      action: "PRODUCT_BULK_IMPORT",
      userId: actor?.id ?? null,
      actor: actor?.name ?? null,
      entity: "Product",
      summary: `Bulk import: ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged`,
      after: { ...result },
    });

    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "PLAN_HAS_ERRORS") {
        return {
          ok: false,
          error:
            "This file has rows that failed validation, so nothing was imported. Fix the errors and preview again.",
        };
      }
      if (err.message === "PLAN_NOTHING_TO_DO") {
        return { ok: false, error: "Every row already matches the catalog — nothing to import." };
      }
      // A unique-SKU collision can still surface at the database level if the
      // catalog changed between the read and the write. Report the actionable
      // "reload and retry" it actually is, rather than a generic failure.
      if (typeof (err as { code?: unknown }).code === "string") {
        return {
          ok: false,
          error:
            "The catalog changed while importing, so nothing was written. Reload the page and try again.",
        };
      }
    }
    return { ok: false, error: "Could not import the products. Nothing was changed." };
  }
}
