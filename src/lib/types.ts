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
