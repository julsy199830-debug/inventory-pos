/**
 * Pure, client-safe audit formatting helpers.
 *
 * Deliberately SEPARATE from `@/lib/audit`: that module statically reaches the
 * Prisma client (via `recordAudit`), so importing it from a Client Component
 * would drag `lib/db` and its native driver adapter into the browser bundle and
 * fail the build. Everything here is a plain function over plain data, with no
 * database and no framework imports, so the audit table can render diffs in the
 * browser.
 *
 * `@/lib/audit` re-exports these, so server-side call sites have a single
 * import path and the two can never drift.
 */

/** A value that can appear in a before/after snapshot. */
export type AuditValue = string | number | boolean | Date | null | undefined;

/** A before/after pair for one action. Only the keys present are compared. */
export type AuditSnapshot = Record<string, AuditValue>;

/**
 * Matches a full ISO-8601 timestamp (the shape `JSON.stringify` produces for a
 * `Date`). Anchored and year-first so an ordinary string that merely starts with
 * digits — an SKU like "2024-01" — is not mistaken for a date.
 */
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Flatten a before/after pair into `{field, from, to}` records, sorted by field
 * name so the output is stable across renders (a diff that reshuffles between
 * two reads of the same data is impossible to scan).
 *
 * A field appears only when its value actually changed, compared with primitive
 * equality. A key present on one side only counts as a change (undefined to
 * value is an addition; value to undefined is a removal).
 */
export function changedFields(
  before: AuditSnapshot | null | undefined,
  after: AuditSnapshot | null | undefined,
): { field: string; from: AuditValue; to: AuditValue }[] {
  const b = before ?? {};
  const a = after ?? {};
  const fields = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: { field: string; from: AuditValue; to: AuditValue }[] = [];
  for (const field of fields) {
    const from = b[field];
    const to = a[field];
    if (from !== to) out.push({ field, from, to });
  }
  return out.sort((x, y) => x.field.localeCompare(y.field));
}

/** Render an {@link AuditValue} for display in the before/after columns. */
export function formatAuditValue(value: AuditValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  // Dates are stored as JSON strings, so a value read back from a snapshot is a
  // string rather than a Date. Recognise that ISO shape and render it in the
  // reader's local time instead of dumping a raw timestamp.
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "string" && ISO_LIKE.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
  }
  return String(value);
}
