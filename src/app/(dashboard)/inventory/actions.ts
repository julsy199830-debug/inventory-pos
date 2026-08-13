"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  asStockMovementType,
  type ActionResult,
  type MutationResult,
  type StockMovementType,
} from "@/lib/types";

/**
 * `load` reads a `FormData` field as a string and coerces an empty/whitespace
 * value to `undefined`, so a missing field is treated as "absent" rather than
 * the literal empty string. Field values arrive as `FormDataEntryValue | null`,
 * so we stringify booleans/files away (unwanted here) before trimming.
 */
function load(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (raw == null) return undefined;
  const str = String(raw).trim();
  return str === "" ? undefined : str;
}

/**
 * Narrow a raw Prisma error to its `code` (e.g. `P2002`, `P2003`, `P2025`) so we
 * can map known failures to friendly, leak-free messages. Returns `undefined`
 * for anything that isn't a Prisma-known error shape.
 */
function prismaCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

// Result type: the shared discriminated {@link ActionResult} from
// `@/lib/types`, aliased here so the action signatures read self-documentingly
// (single source of truth in `lib/types.ts`). The success arm spreads its
// payload onto `{ ok: true }`, so the existing `return { ok: true, sku }` sites
// on create AND update type-check unchanged.
/** Result of {@link createProduct} / {@link updateProduct}. Echos back the
 *  row's `sku` so the client can confirm + close. */
export type CreateProductResult = ActionResult<{ sku?: string }>;

/** Same shape as {@link CreateProductResult} — the edit dialog auto-closes on
 *  `ok` and the revalidated table streams the new values back in. */
export type UpdateProductResult = CreateProductResult;

/** Result of the stock-adjust actions ({@link adjustStock}/{@link setStock}).
 *  Carries the new `stock` so the client can reflect the change before the
 *  revalidated table lands. */
export type StockAdjustResult = ActionResult<{ stock?: number }>;

/** Result of {@link deleteProduct} — surfaces a friendly "can't delete" message
 *  on a foreign-key violation instead of the opaque thrown error the old
 *  `<form action>` wiring produced. No success payload. */
export type DeleteProductResult = ActionResult<void>;

/**
 * One row in the stock-history list — the serialized form of a `StockMovement`
 * shipped to the history modal. `type` is narrowed to a {@link StockMovementType}
 * via {@link asStockMovementType} at read time, and `createdAt` is an ISO string
 * (Date serializes over the Server Action boundary as ISO), which the modal
 * formats for display.
 */
export type StockMovementView = {
  id: string;
  /** Signed change applied to the product's stock: positive for restocks/adjusts
   *  up, negative for sales/damage/adjusts down. */
  quantityChange: number;
  /** Narrowed movement type — the literal from the plain-`String` column. */
  type: StockMovementType;
  /** Free-text reason, or null when the movement logged none (e.g. a sale). */
  reason: string | null;
  /** ISO timestamp of when the movement was recorded. */
  createdAt: string;
};

/**
 * Result of {@link getStockMovements} — the recent movements for one product,
 * shipped to the history modal under the nested `data` arm of {@link
 * MutationResult} so the client reads `result.data.movements`. Uses the nested
 * variant (mirroring {@link CreateSaleResult}) because the payload is a
 * structured read rather than a flat id/name echo.
 */
export type GetStockMovementsResult = MutationResult<{
  movements: StockMovementView[];
}>;

// ── Result types for category CRUD ──────────────────────────────────────────

/** Result of a category mutation ({@link createCategory}/{@link renameCategory}/
 *  {@link setCategoryThreshold}). Echos the category `name` so the management
 *  page can confirm + reflect the change inline. */
export type CategoryResult = ActionResult<{ name?: string }>;

/** Result of {@link deleteCategory} — surfaces a friendly message if the delete
 *  is blocked (a category with products can still be deleted; the FK is
 *  `SetNull`, so products just become uncategorized — but a missing id or an
 *  unexpected DB error is reported here). */
export type DeleteCategoryResult = ActionResult<void>;

// ── Product CRUD ─────────────────────────────────────────────────────────────

/**
 * Server Action backing the "Add New Product" dialog.
 *
 * Reachable by anyone who can POST to the app — like every Server Action — so
 * validation is enforced here on the server, not just in the form. We never
 * trust the client to have run it.
 *
 * `categoryId` replaces the old free-text `category` column. The dialog ships a
 * managed-category `<select>`, so a non-empty value is a real category id — but
 * we still look it up here rather than trusting the id, both to reject a stale
 * id (the category was deleted after the dialog opened) and to keep `""`
 * (uncategorized) legal. On success we `revalidatePath('/inventory')` so the
 * inventory table's cached data is purged and the new row streams in on the
 * next render — no manual refetch needed on the client. The `(dashboard)` route
 * group is a folder-only grouping, so the public path is `/inventory`.
 */
export async function createProduct(
  // Called directly from the dialog's submit handler (the "Event Handlers"
  // convention), so the action takes just `formData` — no `useActionState`
  // `prevState` to honor. The whole page is refreshed by revalidatePath, so
  // there is no client state to merge anyway.
  formData: FormData,
): Promise<CreateProductResult> {
  const name = load(formData, "name");
  const sku = load(formData, "sku")?.toUpperCase();
  const categoryIdRaw = load(formData, "categoryId");
  // Coerce the optional dropdown value: `""`/absent → null (uncategorized), a
  // real id passes through to the FK existence check below.
  const categoryId = categoryIdRaw || null;
  const priceStr = load(formData, "price");
  const costStr = load(formData, "cost");
  const stockStr = load(formData, "stock");

  // ── Required-field & shape validation (server-authoritative) ───────────
  if (!name) return { ok: false, error: "Product name is required." };
  if (!sku) return { ok: false, error: "SKU is required." };

  const price = priceStr != null ? Number(priceStr) : NaN;
  const cost = costStr != null ? Number(costStr) : NaN;
  const stock = stockStr != null ? Number(stockStr) : NaN;

  if (!Number.isFinite(price) || price < 0)
    return { ok: false, error: "Retail price must be a non-negative number." };
  if (!Number.isFinite(cost) || cost < 0)
    return { ok: false, error: "Cost price must be a non-negative number." };
  if (!Number.isInteger(stock) || stock < 0)
    return { ok: false, error: "Stock level must be a whole number ≥ 0." };

  // ── Insert ─────────────────────────────────────────────────────────────
  // `price`/`cost` are Floats and `stock` an Int in the schema; rounding to
  // cents keeps floats tidy and avoids sub-cent drift. The create + the
  // opening-stock audit row are written in one `prisma.$transaction` so a
  // movement write failure rolls the product write back with it — atomicity is
  // the whole point of the audit trail (see StockMovement in schema.prisma).
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name,
          sku,
          categoryId,
          price: Math.round(price * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          stock,
        },
      });
      await tx.stockMovement.create({
        data: {
          productId: created.id,
          quantityChange: stock,
          type: "RESTOCK",
          reason: "Initial stock",
        },
      });
    });
  } catch (err) {
    // P2002 = unique-constraint violation; the only unique field here is `sku`.
    if (prismaCode(err) === "P2002") {
      return { ok: false, error: `A product with SKU "${sku}" already exists.` };
    }
    // P2003 = foreign-key failure — the chosen category id no longer exists.
    if (prismaCode(err) === "P2003") {
      return {
        ok: false,
        error: "That category no longer exists. Please refresh and try again.",
      };
    }
    // Anything else is unexpected — surface a generic message rather than
    // leaking internals, and rethrow nothing so the UI stays usable.
    return { ok: false, error: "Could not save the product. Please try again." };
  }

  revalidatePath("/inventory");
  return { ok: true, sku };
}

/**
 * Update an existing product by its `id`.
 *
 * Same contract as {@link createProduct}, invoked directly from the edit
 * dialog's submit handler, with the row's `id` carried as a hidden field.
 * `categoryId` is now the link to a governed {@link Category} row (or null for
 * uncategorized). SKU is the only editable unique field, so a duplicate-SKU
 * P2002 is caught and surfaced inline (something else owns the new SKU now),
 * and a deleted-mid-edit row lands as P2025 with a friendly "refresh" message.
 *
 * Note: changing `price`/`cost` here updates the *current* product — it does
 * not retroactively change `priceAtSale` on past `SaleItem`s/`TransactionItem`s,
 * which are snapshotted at sale time (by design in the schema).
 */
export async function updateProduct(
  // Called directly from the edit dialog's submit handler (same "Event
  // Handlers" convention as `createProduct`), so it takes just `formData` —
  // no `useActionState` `prevState`. The row's `id` travels as a hidden field
  // in the same payload.
  formData: FormData,
): Promise<UpdateProductResult> {
  const id = load(formData, "id");
  const name = load(formData, "name");
  const sku = load(formData, "sku")?.toUpperCase();
  const categoryIdRaw = load(formData, "categoryId");
  const categoryId = categoryIdRaw || null;
  const priceStr = load(formData, "price");
  const costStr = load(formData, "cost");
  const stockStr = load(formData, "stock");

  if (!id) return { ok: false, error: "Missing product id." };
  if (!name) return { ok: false, error: "Product name is required." };
  if (!sku) return { ok: false, error: "SKU is required." };

  const price = priceStr != null ? Number(priceStr) : NaN;
  const cost = costStr != null ? Number(costStr) : NaN;
  const stock = stockStr != null ? Number(stockStr) : NaN;

  if (!Number.isFinite(price) || price < 0)
    return { ok: false, error: "Retail price must be a non-negative number." };
  if (!Number.isFinite(cost) || cost < 0)
    return { ok: false, error: "Cost price must be a non-negative number." };
  if (!Number.isInteger(stock) || stock < 0)
    return { ok: false, error: "Stock level must be a whole number ≥ 0." };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({
        where: { id },
        select: { stock: true },
      });
      // P2025 mirror: the row was deleted after the modal opened — bred as a
      // typed error below rather than a bare null so the catch maps it.
      if (!before) throw new Error("PRODUCT_NOT_FOUND");
      await tx.product.update({
        where: { id },
        data: {
          name,
          sku,
          categoryId,
          price: Math.round(price * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          stock,
        },
      });
      // Only audit an actual stock change — a pure price/name edit logs no
      // movement. `quantityChange` is the signed delta so a restock-up and a
      // write-down are distinguishable in the history modal.
      const delta = stock - before.stock;
      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            productId: id,
            quantityChange: delta,
            type: "ADJUSTMENT",
            reason: "Edit via inventory",
          },
        });
      }
    });
  } catch (err) {
    if (prismaCode(err) === "P2002") {
      return { ok: false, error: `A product with SKU "${sku}" already exists.` };
    }
    // P2025 = record not found (the row was deleted after the modal opened).
    // Surfaces the same via the typed PRODUCT_NOT_FOUND marker above.
    if (prismaCode(err) === "P2025" || err instanceof Error && err.message === "PRODUCT_NOT_FOUND") {
      return {
        ok: false,
        error: "This product no longer exists. Refresh and try again.",
      };
    }
    // P2003 = the chosen category id no longer exists.
    if (prismaCode(err) === "P2003") {
      return {
        ok: false,
        error: "That category no longer exists. Please refresh and try again.",
      };
    }
    return { ok: false, error: "Could not save the product. Please try again." };
  }

  revalidatePath("/inventory");
  return { ok: true, sku };
}

// ── Inline stock adjustment ──────────────────────────────────────────────────

/**
 * Bump a product's `stock` by a signed integer delta — backs the inline +/−
 * quick-adjust controls in the inventory table. The delta is applied with a
 * read-then-write guard inside a transaction so two concurrent `-2` clicks
 * can't race the floor: we select the current `stock`, reject a delta that
 * would drive it below 0, and otherwise `update` with `{ decrement }`/`{increment }`
 * using an atomic increment op so concurrent adjustments don't lose updates.
 *
 * Returns the new `stock` on success so the row can reflect the change before
 * the revalidated table lands. Like the other actions, this is reachable by any
 * POST, so `delta` and `id` are re-validated here server-side, never trusted.
 */
export async function adjustStock(
  // Invoked directly from the +/- buttons' onClick handlers (the "Event
  // Handlers" convention), so it takes plain arguments rather than FormData.
  id: string,
  delta: number,
): Promise<StockAdjustResult> {
  const safeId = typeof id === "string" ? id.trim() : "";
  const safeDelta = Number(delta);
  if (!safeId) return { ok: false, error: "Missing product id." };
  if (!Number.isFinite(safeDelta) || !Number.isInteger(safeDelta)) {
    return { ok: false, error: "Stock adjustment must be a whole number." };
  }

  try {
    const stock = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: safeId },
        select: { stock: true },
      });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      const next = product.stock + safeDelta;
      if (next < 0) throw new Error("UNDERFLOW");
      await tx.product.update({
        where: { id: safeId },
        data: { stock: next },
      });
      // Audit the inline adjustment inside the same tx: a +N quick-add logs
      // ADJUSTMENT +N, a −N quick-remove logs ADJUSTMENT −N. A zero delta never
      // reaches here (the buttons always pass a nonzero delta), but even if one
      // did it would be a no-op stock write with no movement row logged.
      await tx.stockMovement.create({
        data: {
          productId: safeId,
          quantityChange: safeDelta,
          type: "ADJUSTMENT",
        },
      });
      return next;
    });
    revalidatePath("/inventory");
    return { ok: true, stock };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "UNDERFLOW") {
        return { ok: false, error: "Stock can't go below zero." };
      }
      // PRODUCT_NOT_FOUND and anything else collapse to the same leak-free
      // message — the row may have been deleted, and "could not adjust" is the
      // honest, internals-free copy.
    }
    return { ok: false, error: "Could not adjust stock. Please try again." };
  }
}

/**
 * Replace a product's `stock` with an absolute value — backs the inline
 * "set to" affordance for the inventory table. Rejects negative values
 * server-side and surfaces the new `stock` on success. The `>= 0` floor is the
 * only invariant; any non-negative whole number is a legal restock target.
 */
export async function setStock(
  id: string,
  stockRaw: number,
): Promise<StockAdjustResult> {
  const safeId = typeof id === "string" ? id.trim() : "";
  const stock = Number(stockRaw);
  if (!safeId) return { ok: false, error: "Missing product id." };
  if (!Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) {
    return { ok: false, error: "Stock level must be a whole number ≥ 0." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({
        where: { id: safeId },
        select: { stock: true },
      });
      if (!before) throw new Error("PRODUCT_NOT_FOUND");
      await tx.product.update({
        where: { id: safeId },
        data: { stock },
      });
      // Only audit an actual stock change. `setStock` is most often used to
      // correct inventory to an absolute value after a count, so the signed
      // delta (newStock − oldStock) records whether it was a restock-up or a
      // write-down — useful context in the history modal.
      const delta = stock - before.stock;
      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            productId: safeId,
            quantityChange: delta,
            type: "ADJUSTMENT",
          },
        });
      }
    });
  } catch (err) {
    // P2025 = record not found; the typed marker above surfaces the same path
    // for the row that was deleted between the page load and this write.
    if (prismaCode(err) === "P2025" || (err instanceof Error && err.message === "PRODUCT_NOT_FOUND")) {
      return {
        ok: false,
        error: "This product no longer exists. Refresh and try again.",
      };
    }
    return { ok: false, error: "Could not set stock. Please try again." };
  }

  revalidatePath("/inventory");
  return { ok: true, stock };
}

// ── Stock history read ───────────────────────────────────────────────────────

/**
 * Read the recent {@link StockMovement} rows for one product — backs the
 * per-row "History" modal. Unlike the adjust/product CRUD actions this is a
 * pure read with no `revalidatePath` (nothing it touches is cached against this
 * query), so it ships its result straight back to the client under the nested
 * `data` arm of {@link MutationResult}.
 *
 * We fetch on demand (rather than `include`-ing movements in the page's
 * `findMany`) deliberately: the page lists every product every render, but
 * movements grow without bound for the lifetime of a row, so eagerly loading all
 * of them for all rows would pull the entire audit trail into the page bundle
 * for rows the user never opens. A lazy fetch on modal-open loads only the one
 * product's recent slice.
 *
 * Like every Server Action this is reachable by a direct POST, so `id` is
 * validated server-side rather than trusted from the client. The result mirrors
 * the codebase convention: success is folded into `{ ok: true, data }`, failure
 * is a leak-free `{ ok: false, error }`. `take` caps the slice at 50 — the
 * modal is a "recent history" view, not a full ledger, and 50 newest rows is a
 * generous window without unbounded transfer.
 */
export async function getStockMovements(
  // Invoked directly from the History modal's open handler (the "Event
  // Handlers" convention), so it takes plain arguments rather than FormData.
  id: string,
): Promise<GetStockMovementsResult> {
  const safeId = typeof id === "string" ? id.trim() : "";
  if (!safeId) {
    return { ok: false, error: "Missing product id." };
  }

  try {
    const rows = await prisma.stockMovement.findMany({
      where: { productId: safeId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        quantityChange: true,
        type: true,
        reason: true,
        createdAt: true,
      },
    });
    // Narrow each raw `type` string to the StockMovementType union at the
    // boundary so the client receives a typed payload, never a stray string.
    // `createdAt` (Date) serializes to an ISO string over the action boundary.
    const movements: StockMovementView[] = rows.map((m) => ({
      id: m.id,
      quantityChange: m.quantityChange,
      type: asStockMovementType(m.type),
      reason: m.reason,
      createdAt: m.createdAt.toISOString(),
    }));
    return { ok: true as const, data: { movements } };
  } catch {
    // A read failure is unusual (no FK/P2025 path matters for a select), so a
    // single leak-free message covers it without surfacing internals.
    return { ok: false, error: "Could not load stock history. Please try again." };
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a product by its `id`.
 *
 * Form-driven (so it works with plain HTML and progressive enhancement): the
 * row's hidden `id` field is the only payload. `SaleItem.product` and
 * `TransactionItem.product` are `onDelete: Restrict` in the schema, so deleting
 * a product that has been sold raises a foreign-key violation — we surface that
 * as a friendly message instead of crashing.
 *
 * Like {@link createProduct}, we `revalidatePath('/inventory')` so the row is
 * gone from the cached table on the next render.
 */
export async function deleteProduct(formData: FormData): Promise<DeleteProductResult> {
  const id = load(formData, "id");
  if (!id) {
    // No id means the form was tampered or malformed — nothing to delete.
    return { ok: false, error: "Nothing to delete." };
  }

  try {
    await prisma.product.delete({ where: { id } });
  } catch (err) {
    // P2003 = foreign-key constraint failure (the product is referenced by
    // SaleItem/TransactionItem rows that Restrict deletion).
    if (prismaCode(err) === "P2003") {
      return {
        ok: false,
        error:
          "This product can't be deleted — it appears on existing transactions.",
      };
    }
    // P2025 = already gone — treat as success: the table already reflects the
    // desired state, so there's nothing to surface to the user.
    if (prismaCode(err) === "P2025") {
      revalidatePath("/inventory");
      return { ok: true };
    }
    return { ok: false, error: "Could not delete the product. Please try again." };
  }

  revalidatePath("/inventory");
  return { ok: true };
}

// ── Category CRUD ────────────────────────────────────────────────────────────

/**
 * Server Action backing the "Add category" form on the category management
 * page. `name` is `@unique` on {@link Category}, so a duplicate is caught and
 * surfaced inline. Revalidates `/inventory/categories` (its own table) and
 * `/inventory` (the product-form category dropdown and filters depend on the
 * set of categories). No payload besides the echoed `name`.
 */
export async function createCategory(
  formData: FormData,
): Promise<CategoryResult> {
  const name = load(formData, "name");
  if (!name) return { ok: false, error: "Category name is required." };

  try {
    await prisma.category.create({ data: { name } });
  } catch (err) {
    if (prismaCode(err) === "P2002") {
      return { ok: false, error: `A category named "${name}" already exists.` };
    }
    return { ok: false, error: "Could not create the category. Please try again." };
  }

  revalidatePath("/inventory/categories");
  revalidatePath("/inventory");
  return { ok: true, name };
}

/**
 * Rename an existing {@link Category} by `id`. A rename to a name another
 * category already holds trips P2002 on the unique `name`. `Product` links via
 * `categoryId`, so renaming a category does NOT touch its products — they just
 * keep showing under the new name (no rows to rewrite), which is the point of
 * modeling the link by id rather than the old free-text column.
 */
export async function renameCategory(
  formData: FormData,
): Promise<CategoryResult> {
  const id = load(formData, "id");
  const name = load(formData, "name");
  if (!id) return { ok: false, error: "Missing category id." };
  if (!name) return { ok: false, error: "Category name is required." };

  try {
    await prisma.category.update({ where: { id }, data: { name } });
  } catch (err) {
    if (prismaCode(err) === "P2002") {
      return { ok: false, error: `A category named "${name}" already exists.` };
    }
    if (prismaCode(err) === "P2025") {
      return {
        ok: false,
        error: "This category no longer exists. Refresh and try again.",
      };
    }
    return { ok: false, error: "Could not rename the category. Please try again." };
  }

  revalidatePath("/inventory/categories");
  revalidatePath("/inventory");
  return { ok: true, name };
}

/**
 * Set a {@link Category}'s per-category low-stock `threshold`. The inventory
 * badge treats any product under this as Low Stock (and 0 as Out of Stock);
 * a category with none falls back to the app-wide {@link LOW_STOCK_THRESHOLD}.
 * Negative/non-integer values are rejected server-side.
 */
export async function setCategoryThreshold(
  formData: FormData,
): Promise<CategoryResult> {
  const id = load(formData, "id");
  const thresholdStr = load(formData, "threshold");
  if (!id) return { ok: false, error: "Missing category id." };
  const threshold = Number(thresholdStr);
  if (
    !Number.isFinite(threshold) ||
    !Number.isInteger(threshold) ||
    threshold < 0
  ) {
    return { ok: false, error: "Threshold must be a whole number ≥ 0." };
  }

  try {
    const updated = await prisma.category.update({
      where: { id },
      data: { lowStockThreshold: threshold },
      select: { name: true },
    });
    revalidatePath("/inventory/categories");
    revalidatePath("/inventory");
    return { ok: true, name: updated.name };
  } catch (err) {
    if (prismaCode(err) === "P2025") {
      return {
        ok: false,
        error: "This category no longer exists. Refresh and try again.",
      };
    }
    return {
      ok: false,
      error: "Could not update the threshold. Please try again.",
    };
  }
}

/**
 * Delete a {@link Category} by `id`. The `Product.categoryId` FK is
 * `onDelete: SetNull`, so a category with products is *not* blocked — its
 * products just become uncategorized (the audit trail of their sales is
 * untouched). The only attachable deletion error surface is therefore P2025
 * (already gone) and generic DB failures, both reported here.
 */
export async function deleteCategory(
  formData: FormData,
): Promise<DeleteCategoryResult> {
  const id = load(formData, "id");
  if (!id) return { ok: false, error: "Nothing to delete." };

  try {
    await prisma.category.delete({ where: { id } });
  } catch (err) {
    if (prismaCode(err) === "P2025") {
      // Already gone — the desired state already holds, so report success.
      revalidatePath("/inventory/categories");
      revalidatePath("/inventory");
      return { ok: true };
    }
    return { ok: false, error: "Could not delete the category. Please try again." };
  }

  revalidatePath("/inventory/categories");
  revalidatePath("/inventory");
  return { ok: true };
}
