"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/lib/types";

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

/**
 * Server Action backing the "Add New Product" dialog.
 *
 * Reachable by anyone who can POST to the app — like every Server Action — so
 * validation is enforced here on the server, not just in the form. We never
 * trust the client to have run it.
 *
 * On success we `revalidatePath('/inventory')` so the inventory table's cached
 * data is purged and the new row streams in on the next render — no manual
 * refetch needed on the client. The `(dashboard)` route group is a folder-only
 * grouping, so the public path is `/inventory` (no `(dashboard)` segment).
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
  const category = load(formData, "category");
  const priceStr = load(formData, "price");
  const costStr = load(formData, "cost");
  const stockStr = load(formData, "stock");

  // ── Required-field & shape validation (server-authoritative) ───────────
  if (!name) return { ok: false, error: "Product name is required." };
  if (!sku) return { ok: false, error: "SKU is required." };
  if (!category) return { ok: false, error: "Category is required." };

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
  // cents keeps floats tidy and avoids sub-cent drift.
  try {
    await prisma.product.create({
      data: {
        name,
        sku,
        category,
        price: Math.round(price * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        stock,
      },
    });
  } catch (err) {
    // P2002 = unique-constraint violation; the only unique field here is `sku`.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: `A product with SKU "${sku}" already exists.` };
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
 * Same contract as `createProduct` — `(prevState, formData)` so it slots into
 * `useActionState` — but carries a hidden `id` field identifying the row. SKU
 * is the only editable unique field, so a duplicate-SKU `P2002` is caught and
 * surfaced inline (something else owns the new SKU now). Revalidates so the
 * table reflects the new values on the next render.
 *
 * Note: changing `price`/`cost` here updates the *current* product — it does
 * not retroactively change `priceAtSale` on past `TransactionItem`s, which are
 * snapshotted at sale time (by design in the schema).
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
  const category = load(formData, "category");
  const priceStr = load(formData, "price");
  const costStr = load(formData, "cost");
  const stockStr = load(formData, "stock");

  if (!id) return { ok: false, error: "Missing product id." };
  if (!name) return { ok: false, error: "Product name is required." };
  if (!sku) return { ok: false, error: "SKU is required." };
  if (!category) return { ok: false, error: "Category is required." };

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
    await prisma.product.update({
      where: { id },
      data: {
        name,
        sku,
        category,
        price: Math.round(price * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        stock,
      },
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: `A product with SKU "${sku}" already exists.` };
    }
    // P2025 = record not found (the row was deleted after the modal opened).
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return {
        ok: false,
        error: "This product no longer exists. Refresh and try again.",
      };
    }
    return { ok: false, error: "Could not save the product. Please try again." };
  }

  revalidatePath("/inventory");
  return { ok: true, sku };
}

/**
 * Delete a product by its `id`.
 *
 * Form-driven (so it works with plain HTML and progressive enhancement):
 * the row's hidden `id` field is the only payload. `TransactionItem.product`
 * is `onDelete: Restrict` in the schema, so deleting a product that has been
 * sold raises a foreign-key violation — we surface that as a friendly message
 * instead of crashing.
 *
 * Like `createProduct`, we `revalidatePath('/inventory')` so the row is gone
 * from the cached table on the next render.
 */
export async function deleteProduct(formData: FormData): Promise<void> {
  const id = load(formData, "id");
  if (!id) {
    // No id means the form was tampered or malformed — nothing to delete.
    return;
  }

  try {
    await prisma.product.delete({ where: { id } });
  } catch (err) {
    // P2003 = foreign-key constraint failure (the product is referenced by
    // TransactionItem rows that Restrict deletion). Anything else is unexpected.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2003"
    ) {
      throw new Error(
        "This product can't be deleted — it appears on existing transactions.",
      );
    }
    throw err;
  }

  revalidatePath("/inventory");
}
