"use server";

import { revalidatePath } from "next/cache";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  buildStoredImageName,
  formatImageBytes,
  imageExtensionFor,
  managedImageFileName,
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_PUBLIC_PREFIX,
  safeImageToken,
  sniffImageMime,
  validateImageBytes,
} from "@/lib/product-image";
import {
  asStockMovementType,
  INVALID_IMAGE_URL,
  parseImageUrl,
  type ActionResult,
  type MutationResult,
  type StockMovementType,
} from "@/lib/types";
import { roleGuardError, getCashier } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

/** Staff-only guard shared by every mutating action in this module. */
const STAFF_ROLES = ["ADMIN", "MANAGER"] as const;

async function staffGuardError(): Promise<string | null> {
  return roleGuardError(STAFF_ROLES);
}

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
export type CreateProductResult = ActionResult<{ sku?: string; id?: string }>;

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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
  const name = load(formData, "name");
  const sku = load(formData, "sku")?.toUpperCase();
  const categoryIdRaw = load(formData, "categoryId");
  // Coerce the optional dropdown value: `""`/absent → null (uncategorized), a
  // real id passes through to the FK existence check below.
  const categoryId = categoryIdRaw || null;
  const priceStr = load(formData, "price");
  const costStr = load(formData, "cost");
  const stockStr = load(formData, "stock");
  const imageUrl = parseImageUrl(load(formData, "imageUrl"));
  if (imageUrl === INVALID_IMAGE_URL) {
    return {
      ok: false,
      error: "Image must be a full http(s) URL (e.g. https://…) or left blank.",
    };
  }

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
  let createdId = "";
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
          imageUrl,
        },
      });
      createdId = created.id;
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
  // Audited after commit so a rejected create leaves no trace in the log. The
  // `StockMovement` row written above already records the opening quantity, so
  // this entry carries the fields that movement cannot: identity and pricing.
  const actor = await getCashier();
  await recordAudit({
    action: "PRODUCT_CREATE",
    userId: actor?.id ?? null,
    actor: actor?.name ?? null,
    entity: "Product",
    entityId: createdId,
    summary: `Created product ${sku} — ${name}`,
    after: { sku, name, price, cost, stock, categoryId },
  });
  // `id` rides along so the Add dialog can attach a chosen photo to the row it
  // just created, without a second manual step.
  return { ok: true, sku, id: createdId };
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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
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
  const imageUrl = parseImageUrl(load(formData, "imageUrl"));
  if (imageUrl === INVALID_IMAGE_URL) {
    return {
      ok: false,
      error: "Image must be a full http(s) URL (e.g. https://…) or left blank.",
    };
  }

  if (!Number.isFinite(price) || price < 0)
    return { ok: false, error: "Retail price must be a non-negative number." };
  if (!Number.isFinite(cost) || cost < 0)
    return { ok: false, error: "Cost price must be a non-negative number." };
  if (!Number.isInteger(stock) || stock < 0)
    return { ok: false, error: "Stock level must be a whole number ≥ 0." };

  // Captured inside the transaction for the post-commit audit diff. Only the
  // fields the edit dialog can change, so the entry stays readable.
  let prior: Record<string, string | number | null> | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({
        where: { id },
        select: { stock: true, name: true, sku: true, price: true, cost: true, categoryId: true },
      });
      // P2025 mirror: the row was deleted after the modal opened — bred as a
      // typed error below rather than a bare null so the catch maps it.
      if (!before) throw new Error("PRODUCT_NOT_FOUND");
      prior = {
        name: before.name,
        sku: before.sku,
        price: before.price,
        cost: before.cost,
        stock: before.stock,
        categoryId: before.categoryId,
      };
      await tx.product.update({
        where: { id },
        data: {
          name,
          sku,
          categoryId,
          price: Math.round(price * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          stock,
          imageUrl,
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
  // A before/after pair so the audit UI can show exactly which fields moved —
  // a price change and a cosmetic rename are both "PRODUCT_UPDATE", and the
  // diff is what distinguishes them.
  const actor = await getCashier();
  await recordAudit({
    action: "PRODUCT_UPDATE",
    userId: actor?.id ?? null,
    actor: actor?.name ?? null,
    entity: "Product",
    entityId: id,
    summary: `Edited product ${sku} — ${name}`,
    before: prior,
    after: {
      name,
      sku,
      price: Math.round(price * 100) / 100,
      cost: Math.round(cost * 100) / 100,
      stock,
      categoryId,
    },
  });
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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
  const safeId = typeof id === "string" ? id.trim() : "";
  const safeDelta = Number(delta);
  if (!safeId) return { ok: false, error: "Missing product id." };
  if (!Number.isFinite(safeDelta) || !Number.isInteger(safeDelta)) {
    return { ok: false, error: "Stock adjustment must be a whole number." };
  }

  // Sentinel numbers rather than a nullable object: these are assigned inside the
  // transaction closure, and TypeScript's control-flow analysis narrows a
  // `let x: T | null` declared in the enclosing scope to `null` at the read
  // site, producing `never`. A numeric sentinel sidesteps that entirely.
  // -1 means "no audit payload" (the transaction rejected or never ran).
  let auditFrom = -1;
  let auditTo = -1;
  try {
    const stock = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: safeId },
        select: { stock: true },
      });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      const next = product.stock + safeDelta;
      if (next < 0) throw new Error("UNDERFLOW");
      auditFrom = product.stock;
      auditTo = next;
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
    // The StockMovement row records the quantity delta but not WHO made it.
    // That attribution is the entire reason a write-down exists as an audit
    // event, so it is recorded here.
    if (auditTo >= 0) {
      const actor = await getCashier();
      await recordAudit({
        action: "PRODUCT_STOCK_ADJUST",
        userId: actor?.id ?? null,
        actor: actor?.name ?? null,
        entity: "Product",
        entityId: safeId,
        summary: `Adjusted stock by ${safeDelta > 0 ? "+" : ""}${safeDelta}`,
        before: { stock: auditFrom },
        after: { stock: auditTo, delta: safeDelta },
      });
    }
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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
  const safeId = typeof id === "string" ? id.trim() : "";
  const stock = Number(stockRaw);
  if (!safeId) return { ok: false, error: "Missing product id." };
  if (!Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) {
    return { ok: false, error: "Stock level must be a whole number ≥ 0." };
  }

  // Declared outside the `try` so the post-commit audit write can read them; see
  // the identical sentinels in `adjustStock` for why these are numbers.
  let auditFrom = -1;
  let auditTo = -1;
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({
        where: { id: safeId },
        select: { stock: true },
      });
      if (!before) throw new Error("PRODUCT_NOT_FOUND");
      auditFrom = before.stock;
      auditTo = stock;
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
  if (auditTo >= 0) {
    const actor = await getCashier();
    await recordAudit({
      action: "PRODUCT_STOCK_SET",
      userId: actor?.id ?? null,
      actor: actor?.name ?? null,
      entity: "Product",
      entityId: safeId,
      summary: `Set stock to ${stock}`,
      before: { stock: auditFrom },
      after: { stock: auditTo },
    });
  }
  return { ok: true, stock };
}

// ── Stock count (physical inventory) ────────────────────────────────────────

/** One counted line in a physical stock take. */
export type StockCountLine = {
  productId: string;
  /** What the staff member physically counted on the shelf. */
  counted: number;
};

export type StockCountResult = MutationResult<{
  /** Lines whose counted quantity differed from the system quantity. */
  applied: number;
  /** Lines that already matched — recorded as reconciled, not adjusted. */
  matched: number;
  /** Net unit change written to stock (shrinks negative, finds positive). */
  netChange: number;
}>;

/**
 * Apply a physical stock count.
 *
 * Retail's real problem isn't "can I set a number" — {@link setStock} already
 * does that — it's *reconciling what the shelf says against what the system
 * believes, and explaining the gap*. So this takes the whole count sheet at
 * once, works out the variance per line, and writes one `ADJUSTMENT` movement
 * per discrepant line so every peso and every missing unit lands in the existing
 * stock ledger with a reason a manager can read weeks later.
 *
 * No new schema: this reuses the `StockMovement` table, the `ADJUSTMENT` type
 * already used for manual corrections, and its free-text `reason` column.
 *
 * Lines that match the system are deliberately NOT written — a matching line
 * needs no audit row, and logging thousands of zeroes would bury the real
 * variances. They are still counted in the result so the UI can say "47 of 62
 * matched".
 *
 * All writes land in one transaction: a failure on line 12 rolls back lines
 * 1-11, so a count can never half-apply.
 */
export async function applyStockCount(
  formData: FormData,
): Promise<StockCountResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const reason = load(formData, "countReason") ?? "Physical count";

  // Repeating-field convention, same shape the PO create form uses:
  //   lineCount, productId_1, counted_1, productId_2, counted_2, …
  const lineCount = Number(load(formData, "lineCount") ?? 0);
  if (!Number.isInteger(lineCount) || lineCount <= 0) {
    return { ok: false, error: "Nothing to apply — the count sheet is empty." };
  }
  if (lineCount > 1000) {
    return { ok: false, error: "Count sheet is too large; apply it in batches." };
  }

  const lines: StockCountLine[] = [];
  for (let i = 1; i <= lineCount; i++) {
    const productId = load(formData, `productId_${i}`);
    if (!productId) continue;
    const counted = Number(load(formData, `counted_${i}`));
    if (!Number.isFinite(counted) || !Number.isInteger(counted) || counted < 0) {
      return {
        ok: false,
        error: "Counted quantities must be whole numbers of 0 or more.",
      };
    }
    lines.push({ productId, counted });
  }
  if (lines.length === 0) {
    return { ok: false, error: "Nothing to apply — the count sheet is empty." };
  }

  try {
    const totals = await prisma.$transaction(async (tx) => {
      const rows = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
        select: { id: true, stock: true },
      });
      const systemById = new Map(rows.map((r) => [r.id, r.stock]));

      let applied = 0;
      let matched = 0;
      let netChange = 0;

      for (const line of lines) {
        const system = systemById.get(line.productId);
        // A product deleted between the sheet being rendered and the count
        // being submitted: skip it rather than failing the whole count. This is
        // a reconciliation, not a transaction the user can retry per-line.
        if (system === undefined) continue;

        const delta = line.counted - system;
        if (delta === 0) {
          matched += 1;
          continue;
        }
        await tx.product.update({
          where: { id: line.productId },
          data: { stock: line.counted },
        });
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            quantityChange: delta,
            type: "ADJUSTMENT",
            reason: `Stock count: ${reason}`,
          },
        });
        applied += 1;
        netChange += delta;
      }
      return { applied, matched, netChange };
    });

    revalidatePath("/inventory");
    revalidatePath("/");
    // A stock count is the highest-leverage inventory event there is — it can
    // move every product's quantity at once — so the actor and the headline
    // numbers are recorded even though the per-line detail is already in
    // StockMovement.
    const actor = await getCashier();
    await recordAudit({
      action: "PRODUCT_STOCK_COUNT",
      userId: actor?.id ?? null,
      actor: actor?.name ?? null,
      entity: "StockCount",
      summary: `Physical count: ${totals.applied} corrected, ${totals.matched} matched, net ${totals.netChange > 0 ? "+" : ""}${totals.netChange}`,
      after: {
        corrected: totals.applied,
        matched: totals.matched,
        netChange: totals.netChange,
        reason,
      },
    });
    return { ok: true, data: totals };
  } catch (err) {
    if (prismaCode(err) === "P2025") {
      return {
        ok: false,
        error: "A product in this count no longer exists. Refresh and recount.",
      };
    }
    return { ok: false, error: "Could not apply the stock count. Please try again." };
  }
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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
  const id = load(formData, "id");
  if (!id) {
    // No id means the form was tampered or malformed — nothing to delete.
    return { ok: false, error: "Nothing to delete." };
  }

  // Snapshot the row BEFORE deleting it: a delete destroys the only remaining
  // record of what the product was, so without this the audit log could say
  // "a product was deleted" and nothing more.
  const doomed = await prisma.product.findUnique({
    where: { id },
    select: { id: true, sku: true, name: true, price: true, stock: true },
  });
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
  if (doomed) {
    const actor = await getCashier();
    await recordAudit({
      action: "PRODUCT_DELETE",
      userId: actor?.id ?? null,
      actor: actor?.name ?? null,
      entity: "Product",
      entityId: doomed.id,
      summary: `Deleted product ${doomed.sku} — ${doomed.name}`,
      // Everything goes in `before`, because after the delete there is no
      // "after" to speak of.
      before: { sku: doomed.sku, name: doomed.name, price: doomed.price, stock: doomed.stock },
    });
  }
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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
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
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
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

// ── Product image upload / removal (Phase 1c) ───────────────────────────────

/** Absolute directory that serves managed product photos. `public/` is served
 *  statically by Next in both dev and `next start`, so an upload is a plain
 *  filesystem write with no upload service, CDN or database blob. */
const PRODUCT_IMAGE_DIR = path.join(process.cwd(), "public", "uploads", "products");

/** Best-effort unlink. A missing file is success (the row is already clear); a
 *  locked file must never fail the request, because the product's `imageUrl` is
 *  the source of truth and it has already been cleared. */
async function unlinkQuietly(fileName: string): Promise<void> {
  try {
    await unlink(path.join(PRODUCT_IMAGE_DIR, fileName));
  } catch {
    // Intentionally ignored — see the doc comment.
  }
}

/** Result of {@link uploadProductImage} / {@link removeProductImage}. Carries the
 *  resulting `imageUrl` so the client can update its preview without waiting for
 *  the revalidated page. */
export type ProductImageResult = MutationResult<{ imageUrl: string | null }>;

/**
 * Upload (or replace) a product's photo.
 *
 * Storage is deliberately the simplest thing that works for a self-hosted LAN
 * register: a file under `public/uploads/products/`, referenced by a root-relative
 * `Product.imageUrl` — the field Phase 1a already added. No schema change, no
 * blob column, no external bucket.
 *
 * Security notes, because a Server Action is a public POST endpoint:
 *  - the caller must be staff, exactly like every other inventory mutation;
 *  - the bytes are identified by magic number, never by the client's declared
 *    MIME type or filename, so a script-bearing document can never be stored and
 *    later served same-origin;
 *  - the stored name is a generated token, so user input never reaches the
 *    filesystem path;
 *  - the previous managed file is unlinked only after the row is updated, so a
 *    failed write never destroys the photo the product still points at.
 */
export async function uploadProductImage(
  formData: FormData,
): Promise<ProductImageResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const productId = load(formData, "id");
  if (!productId) return { ok: false, error: "Missing product id." };

  const entry = formData.get("image");
  if (!(entry instanceof File)) {
    return { ok: false, error: "Choose an image to upload." };
  }
  if (entry.size > MAX_PRODUCT_IMAGE_BYTES) {
    return {
      ok: false,
      error: `Images must be ${formatImageBytes(MAX_PRODUCT_IMAGE_BYTES)} or smaller.`,
    };
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  const invalid = validateImageBytes(bytes);
  if (invalid) return { ok: false, error: invalid };

  const extension = imageExtensionFor(sniffImageMime(bytes));
  if (!extension) return { ok: false, error: "That file is not a supported image." };

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, imageUrl: true },
  });
  if (!product) return { ok: false, error: "That product no longer exists." };

  // `safeImageToken` is belt-and-braces: `randomUUID` is already a safe token,
  // but sanitising here means the "user input never reaches the filesystem
  // path" property holds by construction rather than by assumption.
  const fileName = buildStoredImageName(extension, safeImageToken(randomUUID()));
  const publicUrl = `${PRODUCT_IMAGE_PUBLIC_PREFIX}${fileName}`;

  try {
    await mkdir(PRODUCT_IMAGE_DIR, { recursive: true });
    await writeFile(path.join(PRODUCT_IMAGE_DIR, fileName), bytes, { flag: "wx" });
  } catch {
    return { ok: false, error: "Could not save the image. Please try again." };
  }

  try {
    await prisma.product.update({
      where: { id: productId },
      data: { imageUrl: publicUrl },
    });
  } catch {
    // The row still points at the old photo (or none), so the file we just
    // wrote is an orphan — drop it rather than leaking bytes on every failure.
    await unlinkQuietly(fileName);
    return { ok: false, error: "Could not attach the image. Please try again." };
  }

  // Only now is it safe to drop the superseded file. Skipped when the product
  // previously pointed at an external LAN/NAS image, which we don't own.
  const previous = managedImageFileName(product.imageUrl);
  if (previous && previous !== fileName) await unlinkQuietly(previous);

  revalidatePath("/inventory");
  revalidatePath("/pos");
  return { ok: true, data: { imageUrl: publicUrl } };
}

/**
 * Clear a product's photo and delete the managed file behind it.
 *
 * Idempotent: a product with no image is already in the desired state, so this
 * reports success rather than erroring on a double-click. An image hosted
 * elsewhere (a LAN/NAS URL typed into the dialog) is simply forgotten — the
 * reference is dropped, but a file this app does not own is never unlinked.
 */
export async function removeProductImage(
  formData: FormData,
): Promise<ProductImageResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const productId = load(formData, "id");
  if (!productId) return { ok: false, error: "Missing product id." };

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, imageUrl: true },
  });
  if (!product) return { ok: false, error: "That product no longer exists." };

  try {
    await prisma.product.update({ where: { id: productId }, data: { imageUrl: null } });
  } catch {
    return { ok: false, error: "Could not remove the image. Please try again." };
  }

  const managed = managedImageFileName(product.imageUrl);
  if (managed) await unlinkQuietly(managed);

  revalidatePath("/inventory");
  revalidatePath("/pos");
  return { ok: true, data: { imageUrl: null } };
}
