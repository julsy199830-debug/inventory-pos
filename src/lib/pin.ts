/**
 * The login-PIN shape rule, shared by every place that validates a cashier PIN.
 *
 * 4–6 digits, nothing else, kept as a string (not a number) so leading zeros are
 * preserved — a "0123" PIN must not collapse to "123" (see the `User.pin` schema
 * comment). Kept here at the library layer — not the Prisma schema — because
 * SQLite stores `pin` as a plain `String` and the schema only commits the shape,
 * exactly like `Sale.status` / `User.role`: the column holds the literal and the
 * set of allowed values is enforced at the TypeScript layer.
 *
 * Re-exported from the Employees and POS action files so there's a single source
 * of truth for the rule across create-employee, edit-employee, and cashier sign-in.
 */
export const PIN_PATTERN = /^\d{4,6}$/;
