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
