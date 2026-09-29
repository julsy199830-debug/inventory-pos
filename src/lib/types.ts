/**
 * Shared domain types that aren't (or can't be) expressed at the Prisma layer.
 *
 * These mirror the convention used for `Sale.status` / `Transaction.status` in
 * `schema.prisma`: the column is a plain `String` (SQLite has no native enum
 * and we deliberately didn't probe for one), and the set of allowed literals is
 * narrowed here at the TypeScript layer. Keep the runtime values in sync with
 * the `@default(...)` and any writes in the server actions.
 */

/** Authorization roles for a {@link User}. */
export type Role = "ADMIN" | "MANAGER" | "CASHIER";

/** All valid role literals — useful for validation and seeding. */
export const ROLES: readonly Role[] = ["ADMIN", "MANAGER", "CASHIER"] as const;

/**
 * Narrows an arbitrary value (e.g. a raw `User.role` string from Prisma, or
 * client input) to a {@link Role}. Falls back to `CASHIER` (least privileged)
 * when the value is missing or unrecognized, so unknown strings can never widen
 * a session's permissions.
 */
export function asRole(value: string | null | undefined): Role {
  return ROLES.includes(value as Role) ? (value as Role) : "CASHIER";
}

// ── Inventory ────────────────────────────────────────────────────────────────
//
// The "running low" threshold for stock. A product is Low Stock when its `stock`
// is strictly below this threshold and Out of Stock when it's 0. The default
// applies to uncategorized products and to categories with no explicit
// `Category.lowStockThreshold`; a category may override it (raise for
// high-velocity lines, lower for slow movers) via the category management page.
//
// Keep this value in sync with `Category.lowStockThreshold @default(10)` in
// `schema.prisma` so a freshly seeded DB and the TS fallback agree.
export const LOW_STOCK_THRESHOLD = 10;

/**
 * Derive a product's low-stock cutoff from its category: a category may
 * override the app-wide default by setting `Category.lowStockThreshold`; a
 * product whose category has none (or is uncategorized) falls back to
 * {@link LOW_STOCK_THRESHOLD}. Modeled as a plain function on a nullable
 * threshold so the inventory page, the category management page, and any
 * alert surface all agree on a single rule.
 */
export function lowStockThresholdFor(categoryThreshold: number | null | undefined): number {
  return categoryThreshold == null ? LOW_STOCK_THRESHOLD : categoryThreshold;
}

/** Coarse stock status used by the inventory badges and any restock surface. */
export type StockStatus = "out" | "low" | "ok";

/**
 * Classify a product's `stock` against its effective low-stock threshold. 0 is
 * always Out of Stock; otherwise Low Stock when `stock` is strictly below the
 * cutoff, In Stock when at or above it. Pairs with
 * {@link lowStockThresholdFor} so the same per-category rule powers the label
 * and the color across views.
 */
export function stockStatusAt(
  stock: number,
  categoryThreshold: number | null | undefined,
): StockStatus {
  if (stock <= 0) return "out";
  return stock < lowStockThresholdFor(categoryThreshold) ? "low" : "ok";
}

/**
 * The kind of {@link StockMovement} recorded for a stock change. Mirrors the
 * plain-`String` `StockMovement.type` column in `schema.prisma`: the column
 * holds the literal, and the allowed set is enforced here at the TypeScript
 * layer (SQLite has no native enum — same convention as {@link Role} and
 * `Sale.status`).
 */
export type StockMovementType = "RESTOCK" | "SALE" | "ADJUSTMENT" | "DAMAGE" | "VOID";

// ── Purchase order status ────────────────────────────────────────────────────

/**
 * The lifecycle of a `PurchaseOrder`, as plain string literals.
 *
 * Lives here rather than in `purchasing/actions.ts` because that module is
 * `"use server"`, and such a module may only export async functions —
 * exporting a value from one once broke every action in the employees module.
 * This file is the repo's established home for these vocabularies, alongside
 * {@link ROLES} and {@link STOCK_MOVEMENT_TYPES}. `purchasing/actions.ts`
 * re-exports the *type* (`export type` erases at runtime, so that is safe).
 */
export const PO_STATUSES = [
  "DRAFT",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

/** One of the {@link PO_STATUSES} literals. */
export type PoStatus = (typeof PO_STATUSES)[number];

/** All valid movement-type literals — useful for validation. */
export const STOCK_MOVEMENT_TYPES: readonly StockMovementType[] = [
  "RESTOCK",
  "SALE",
  "ADJUSTMENT",
  "DAMAGE",
  "VOID",
] as const;

/**
 * Narrows an arbitrary value (e.g. a raw `StockMovement.type` string from
 * Prisma, or client input) to a {@link StockMovementType}. Falls back to
 * `ADJUSTMENT` when the value is missing or unrecognized — `ADJUSTMENT` is the
 * safest generic bucket for an unknown cause, since it carries no implication
 * of direction (unlike `RESTOCK`/`SALE`/`DAMAGE`), so a stray string can never
 * mislabel a movement as a restock or a write-off. Mirrors {@link asRole}.
 */
export function asStockMovementType(
  value: string | null | undefined,
): StockMovementType {
  return STOCK_MOVEMENT_TYPES.includes(value as StockMovementType)
    ? (value as StockMovementType)
    : "ADJUSTMENT";
}

// ── Server Action result shapes ─────────────────────────────────────────────
//
// Every Server Action in the app resolves to one of these rather than throwing
// into React's nearest error boundary — a thrown action rejects the client's
// promise and freezes "Saving…" pending state, so handled failures are folded
// into a `{ ok: false, error }` arm the dialog can render inline. The success
// arm carries an optional payload, so a create action can echo back the row's
// name/SKU/shift id for an inline confirmation while an idempotent toggle
// returns the bare `{ ok: true }`.
//
// This single type subsumes the per-module result types that were previously
// scattered across the action files:
//
//   ActionResult<void>                  →  SignInResult / ShiftResult (no payload)
//   ActionResult<{ id: string }>        →  CreateSaleResult
//   ActionResult<{ name?: string }>    →  CreateEmployeeResult / CreateCustomerResult
//                                        /  CreateSupplierResult
//   ActionResult<{ sku?: string }>     →  CreateProductResult / UpdateProductResult
//
// The success-payload is mapped onto the arm as *spread* extra props rather
// than a nested `data` field so existing action bodies (which return
// `{ ok: true, name }`, `{ ok: true, sku }`, etc.) and the clients that read
// them need no changes — the discriminated `ok` is preserved so callers still
// narrow with `if (result.ok)`.
//
// NOTE: a `"use server"` module may only export async functions (see the
// comment at the foot of `src/app/(dashboard)/employees/actions.ts` — exporting
// `ROLES` once broke every action there). Action result *types* are erased at
// runtime so their `export type` re-exports are tolerated, but this definition
// lives in the plain (non-server) `lib/types.ts` so the single source of truth
// is importable everywhere without a runtime export ever being a value.

/**
 * Discriminated result returned by a Server Action to its caller.
 *
 * - `{ ok: false; error }` is the failure arm (validation, unique-constraint,
 *   generic server error) — `error` is always present and leak-free.
 * - The success arm spreads the payload `T` onto `{ ok: true }`, so
 *   `ActionResult<{ name?: string }>` is `{ ok: true; name?: string }`.
 *   `T = void` (the default) is the bare success `{ ok: true }` with no extra
 *   fields — the shape idempotent/checkout actions return.
 */
export type ActionResult<T extends Record<string, unknown> | void = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

/**
 * Variant of {@link ActionResult} whose success payload lives under a nested
 * `data` field instead of being spread flat. Use it for actions that carry a
 * structured payload the client reads as `result.data.x` (e.g. the sale id
 * returned by POS checkout) — the rest of the app uses flat-payload
 * {@link ActionResult} aliases.
 *
 * `MutationResult<void>` collapses to the bare `{ ok: true } | { ok: false;
 * error }` success/no-payload shape, identical to `ActionResult<void>`.
 */
export type MutationResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

// ── Product image URLs ─────────────────────────────────────────────────────

/**
 * Sentinel returned by {@link parseImageUrl} for a value that is present but
 * unusable. Distinct from `null` (which means "no image, and that is fine") so
 * a caller can tell "cleared it" apart from "you typed nonsense" without a
 * second return channel.
 */
export const INVALID_IMAGE_URL = Symbol("invalid-image-url");

/**
 * Normalize a user-supplied product image reference.
 *
 * Accepts an absolute `http(s)` URL or a root-relative path (`/images/x.jpg`),
 * which is what a self-hosted LAN install actually wants — an image served by
 * the store's own Next server or a NAS share. Anything else (a `javascript:`
 * payload, a `data:` URI, a bare word) is rejected, because `imageUrl` is
 * rendered into an `<img src>` and we don't want a stored-XSS foothold or a
 * broken image on every POS tile.
 *
 * An empty/absent value normalizes to `null` — that is how a product ends up
 * with "no photo" and shows the generated placeholder instead.
 *
 * Returns `INVALID_IMAGE_URL` for present-but-invalid input; see that symbol.
 */
export function parseImageUrl(
  raw: string | null | undefined,
): string | null | typeof INVALID_IMAGE_URL {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  if (value.length > 2000) return INVALID_IMAGE_URL;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return INVALID_IMAGE_URL;
    }
    return url.toString();
  } catch {
    return INVALID_IMAGE_URL;
  }
}

/** `true` when the product has a usable stored photo. Narrows away the sentinel. */
export function hasProductImage(
  imageUrl: string | null | undefined,
): imageUrl is string {
  return typeof imageUrl === "string" && imageUrl.trim() !== "";
}
