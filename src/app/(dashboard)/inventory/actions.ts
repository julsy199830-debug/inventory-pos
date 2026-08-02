"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { LOW_STOCK_THRESHOLD, type ActionResult } from "@/lib/types";

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

/** Result of the stock-adjust actions ({@link adjustStock}/{@link setStock}).
 *  Carries the new `stock` so the client can reflect the change before the
 *  revalidated table lands. */
export type StockAdjustResult = ActionResult<{ stock?: number }>;

/** Result of {@link deleteProduct} — surfaces a friendly "can't delete" message
 *  on a foreign-key violation instead of the opaque thrown error the old
 *  `<form action>` wiring produced. No success payload. */
export type DeleteProductResult = ActionResult<void>;

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
