/**
 * The administrative audit trail (Phase 1e).
 *
 * ## Why this is a separate, never-throwing helper
 *
 * An audit write is *observability*, not business logic. The rule that matters
 * is that instrumenting an action must never change whether that action
 * succeeds: a full disk, a locked database, or a bug in this file must not stop
 * a cashier from completing a sale or a manager from voiding one. So
 * {@link recordAudit} swallows every failure and logs a warning instead of
 * throwing, and it is always called AFTER the business transaction has
 * committed — a rolled-back action never leaves a phantom audit row.
 *
 * This is the deliberate trade-off: an audit row can be *missed* if the audit
 * write itself fails, but a business action is never lost because of it. The
 * alternative (auditing inside the transaction) would guarantee the row but let
 * an audit problem roll back real money movement, which is strictly worse.
 */

/** Coarse module groupings, matching the sidebar's information architecture. */
export const AUDIT_MODULES = [
  "AUTH",
  "INVENTORY",
  "SALES",
  "LOYALTY",
  "CUSTOMERS",
  "SUPPLIERS",
  "EMPLOYEES",
  "PURCHASING",
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];

/**
 * Every auditable action, as a stable machine token.
 *
 * The tokens are the API: the UI's filter dropdown is generated from this list,
 * so an action can never be written that the filter cannot find, and a filter
 * can never offer an action the app never writes. The `module` each belongs to
 * is declared in {@link ACTION_MODULES} rather than repeated per call site, so
 * the action→module mapping is defined exactly once.
 */
export const AUDIT_ACTIONS = [
  // AUTH
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "LOGIN_RATE_LIMITED",
  "LOGOUT",
  // INVENTORY
  "PRODUCT_CREATE",
  "PRODUCT_UPDATE",
  "PRODUCT_DELETE",
  "PRODUCT_STOCK_ADJUST",
  "PRODUCT_STOCK_SET",
  "PRODUCT_STOCK_COUNT",
  "PRODUCT_BULK_IMPORT",
  // SALES
  "SALE_VOID",
  "SALE_VOID_BLOCKED",
  "SALE_REFUND",
  "SALE_REFUND_BLOCKED",
  // LOYALTY
  "LOYALTY_REDEEM",
  // CUSTOMERS
  "CUSTOMER_CREATE",
  "CUSTOMER_UPDATE",
  "CUSTOMER_DELETE",
  "CUSTOMER_PAYMENT",
  // SUPPLIERS
  "SUPPLIER_CREATE",
  "SUPPLIER_UPDATE",
  "SUPPLIER_DELETE",
  // EMPLOYEES
  "EMPLOYEE_CREATE",
  "EMPLOYEE_UPDATE",
  "EMPLOYEE_ROLE_CHANGE",
  "EMPLOYEE_STATUS_CHANGE",
  "EMPLOYEE_DELETE",
  "EMPLOYEE_SHIFT_IN",
  "EMPLOYEE_SHIFT_OUT",
  // PURCHASING
  "PO_CREATE",
  "PO_UPDATE",
  "PO_ORDER",
  "PO_CANCEL",
  "PO_RECEIVE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Which module each action belongs to. Drives the UI's module filter grouping. */
export const ACTION_MODULES: Record<AuditAction, AuditModule> = {
  LOGIN_SUCCESS: "AUTH",
  LOGIN_FAILURE: "AUTH",
  LOGIN_RATE_LIMITED: "AUTH",
  LOGOUT: "AUTH",
  PRODUCT_CREATE: "INVENTORY",
  PRODUCT_UPDATE: "INVENTORY",
  PRODUCT_DELETE: "INVENTORY",
  PRODUCT_STOCK_ADJUST: "INVENTORY",
  PRODUCT_STOCK_SET: "INVENTORY",
  PRODUCT_STOCK_COUNT: "INVENTORY",
  PRODUCT_BULK_IMPORT: "INVENTORY",
  SALE_VOID: "SALES",
  SALE_VOID_BLOCKED: "SALES",
  SALE_REFUND: "SALES",
  SALE_REFUND_BLOCKED: "SALES",
  LOYALTY_REDEEM: "LOYALTY",
  CUSTOMER_CREATE: "CUSTOMERS",
  CUSTOMER_UPDATE: "CUSTOMERS",
  CUSTOMER_DELETE: "CUSTOMERS",
  CUSTOMER_PAYMENT: "CUSTOMERS",
  SUPPLIER_CREATE: "SUPPLIERS",
  SUPPLIER_UPDATE: "SUPPLIERS",
  SUPPLIER_DELETE: "SUPPLIERS",
  EMPLOYEE_CREATE: "EMPLOYEES",
  EMPLOYEE_UPDATE: "EMPLOYEES",
  EMPLOYEE_ROLE_CHANGE: "EMPLOYEES",
  EMPLOYEE_STATUS_CHANGE: "EMPLOYEES",
  EMPLOYEE_DELETE: "EMPLOYEES",
  EMPLOYEE_SHIFT_IN: "EMPLOYEES",
  EMPLOYEE_SHIFT_OUT: "EMPLOYEES",
  PO_CREATE: "PURCHASING",
  PO_UPDATE: "PURCHASING",
  PO_ORDER: "PURCHASING",
  PO_CANCEL: "PURCHASING",
  PO_RECEIVE: "PURCHASING",
};


/** Human labels for the audit UI. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN_SUCCESS: "Signed in",
  LOGIN_FAILURE: "Failed sign-in",
  LOGIN_RATE_LIMITED: "Sign-in throttled",
  LOGOUT: "Signed out",
  PRODUCT_CREATE: "Product created",
  PRODUCT_UPDATE: "Product edited",
  PRODUCT_DELETE: "Product deleted",
  PRODUCT_STOCK_ADJUST: "Stock adjusted",
  PRODUCT_STOCK_SET: "Stock set",
  PRODUCT_STOCK_COUNT: "Physical stock count",
  PRODUCT_BULK_IMPORT: "Bulk product import",
  SALE_VOID: "Sale voided",
  SALE_VOID_BLOCKED: "Void rejected",
  SALE_REFUND: "Sale refunded",
  SALE_REFUND_BLOCKED: "Refund rejected",
  LOYALTY_REDEEM: "Loyalty points redeemed",
  CUSTOMER_CREATE: "Customer created",
  CUSTOMER_UPDATE: "Customer edited",
  CUSTOMER_DELETE: "Customer deleted",
  CUSTOMER_PAYMENT: "Customer payment recorded",
  SUPPLIER_CREATE: "Supplier created",
  SUPPLIER_UPDATE: "Supplier edited",
  SUPPLIER_DELETE: "Supplier deleted",
  EMPLOYEE_CREATE: "Employee added",
  EMPLOYEE_UPDATE: "Employee edited",
  EMPLOYEE_ROLE_CHANGE: "Role changed",
  EMPLOYEE_STATUS_CHANGE: "Access changed",
  EMPLOYEE_DELETE: "Employee deleted",
  EMPLOYEE_SHIFT_IN: "Clocked in",
  EMPLOYEE_SHIFT_OUT: "Clocked out",
  PO_CREATE: "PO created",
  PO_UPDATE: "PO edited",
  PO_ORDER: "PO ordered",
  PO_CANCEL: "PO cancelled",
  PO_RECEIVE: "Stock received",
};

export const AUDIT_MODULE_LABELS: Record<AuditModule, string> = {
  AUTH: "Authentication",
  INVENTORY: "Inventory",
  SALES: "Sales",
  LOYALTY: "Loyalty",
  CUSTOMERS: "Customers",
  SUPPLIERS: "Suppliers",
  EMPLOYEES: "Employees",
  PURCHASING: "Purchasing",
};

// The snapshot types and the before/after diffing helpers live in a separate,
// client-safe module: this file statically reaches the Prisma client, so a
// Client Component importing it would pull the database driver into the
// browser bundle. They are re-exported here so server-side call sites still
// have one import path and the two definitions cannot drift.
export type { AuditSnapshot, AuditValue } from "@/lib/audit-format";
export { changedFields, formatAuditValue } from "@/lib/audit-format";

import type { AuditSnapshot } from "@/lib/audit-format";

/** Everything {@link recordAudit} needs to write one row. */
export type AuditEntry = {
  /** What happened. Also decides the module via {@link ACTION_MODULES}. */
  action: AuditAction;
  /** The acting user's id, or null for a system/failed-login event. */
  userId?: string | null;
  /** The acting user's name, snapshotted so the row survives user deletion. */
  actor?: string | null;
  /** The kind of record affected, e.g. "Product". */
  entity?: string | null;
  /** Primary key of the affected record, when known. */
  entityId?: string | null;
  /** One-line human summary. Auto-derived from `action`/`entity` when omitted. */
  summary?: string | null;
  /** Field values before the change. */
  before?: AuditSnapshot | null;
  /** Field values after the change. */
  after?: AuditSnapshot | null;
};

/** Default one-line summary when a call site doesn't supply one. */
export function defaultAuditSummary(
  action: AuditAction,
  entity: string | null | undefined,
): string {
  const label = AUDIT_ACTION_LABELS[action] ?? action;
  if (!entity) return label;
  return `${label} — ${entity}`;
}

/** Serialize a snapshot to JSON for storage, or null when it has nothing useful. */
function encodeSnapshot(snapshot: AuditSnapshot | null | undefined): string | null {
  if (!snapshot) return null;
  // Drop empty snapshots so "nothing to compare" is a real null rather than a
  // "{}" that would render as a confusing empty diff.
  if (Object.keys(snapshot).length === 0) return null;
  return JSON.stringify(snapshot);
}

/**
 * Write one audit row.
 *
 * Declared `async` and awaited by callers so a slow write doesn't leak past a
 * Server Action's response, but it NEVER rejects: every failure is caught and
 * reported via `console.warn`. That is the whole contract, as explained in the
 * file header.
 *
 * The Prisma client is imported lazily *inside* the function so that importing
 * this module from a pure unit test (which only needs `changedFields`) does not
 * pull in the database adapter.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const { prisma } = await import("@/lib/db");
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        actor: entry.actor ?? null,
        action: entry.action,
        module: ACTION_MODULES[entry.action],
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        summary: entry.summary?.trim() || defaultAuditSummary(entry.action, entry.entity),
        before: encodeSnapshot(entry.before),
        after: encodeSnapshot(entry.after),
      },
    });
  } catch (error) {
    // Deliberately swallowed, as explained in the file header. The business
    // action that triggered this audit has already committed and is unaffected.
    console.warn("[audit] failed to record entry", entry.action, error);
  }
}

