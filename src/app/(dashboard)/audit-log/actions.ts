import { prisma } from "@/lib/db";
import { roleGuardError } from "@/lib/session";
import type { MutationResult } from "@/lib/types";
import {
  ACTION_MODULES,
  AUDIT_ACTION_LABELS,
  AUDIT_MODULES,
  AUDIT_MODULE_LABELS,
  type AuditAction,
  type AuditModule,
} from "@/lib/audit";

const STAFF_ROLES = ["ADMIN", "MANAGER"] as const;

async function staffGuardError(): Promise<string | null> {
  return roleGuardError(STAFF_ROLES);
}

/** One audit row, serialized for the client. */
export type AuditLogRow = {
  id: string;
  createdAt: string;
  actor: string | null;
  action: string;
  actionLabel: string;
  module: string;
  entity: string | null;
  entityId: string | null;
  summary: string;
  /** Parsed before/after snapshots; null when the event has no field detail. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** The filter state, mirrored into the URL so a view is shareable/reloadable. */
export type AuditLogFilters = {
  /** Free-text over actor, summary, entity and entityId. */
  query: string;
  /** Empty = every module. */
  module: string;
  /** Empty = every action. */
  action: string;
  /** Exact user id, or empty for all. */
  userId: string;
  /** Inclusive local-time day window, or empty for unbounded. */
  from: string;
  to: string;
};

/** How many rows one page load returns. */
const PAGE_SIZE = 100;

/** Parse a `YYYY-MM-DD` day into a local-time range, or null when malformed. */
function dayBounds(date: string, endOfDay: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}


/**
 * Load a page of audit rows, newest first, with the supplied filters applied.
 *
 * Filters compose with AND. A malformed date is ignored rather than rejected —
 * dropping one boundary is far more useful than an error page for a mistyped
 * filter, and an unbounded side is the safe direction (it shows more history,
 * never hides a security event).
 *
 * Capped at {@link PAGE_SIZE} with a `hasMore` flag rather than offset-paginated:
 * this is an inspection tool for "what happened recently", and paging an
 * append-only table by offset gets both slower and more confusing as it grows.
 */
export async function getAuditLogs(
  filters: AuditLogFilters,
): Promise<
  MutationResult<{
    rows: AuditLogRow[];
    hasMore: boolean;
    /** Total matching rows, for the "showing N of M" line. */
    total: number;
    actors: AuditActor[];
  }>
> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const where: Record<string, unknown> = {};
  const from = dayBounds(filters.from ?? "", false);
  const to = dayBounds(filters.to ?? "", true);
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  if (filters.module && (AUDIT_MODULES as readonly string[]).includes(filters.module)) {
    where.module = filters.module;
  }
  if (filters.action && Object.prototype.hasOwnProperty.call(AUDIT_ACTION_LABELS, filters.action)) {
    where.action = filters.action;
  }
  if (filters.userId) where.userId = filters.userId;
  const query = (filters.query ?? "").trim();
  if (query) {
    where.OR = [
      { actor: { contains: query } },
      { summary: { contains: query } },
      { entity: { contains: query } },
      { entityId: { contains: query } },
    ];
  }

  try {
    const [rows, total, actorRows] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE + 1,
        // `actor` is a write-time snapshot, but joining `user` costs nothing on
        // a capped query and rescues rows written before a name was captured
        // (or by a caller that omitted it).
        include: { user: { select: { name: true } } },
      }),
      prisma.auditLog.count({ where }),
      // The actor list comes from the whole log, not the filtered slice, so the
      // dropdown keeps offering users whose recent activity is filtered out.
      prisma.auditLog.findMany({
        where: { userId: { not: null } },
        distinct: ["userId"],
        select: { userId: true, actor: true },
        take: 200,
      }),
    ]);

    const hasMore = rows.length > PAGE_SIZE;
    return {
      ok: true,
      data: {
        rows: rows.slice(0, PAGE_SIZE).map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          // Snapshotted actor name first, so a deleted employee's entries stay
          // attributable; "System" covers genuinely unattributed events.
          actor: row.actor ?? row.user?.name ?? "System",
          action: row.action,
          actionLabel:
            AUDIT_ACTION_LABELS[row.action as AuditAction] ?? row.action,
          module: row.module,
          entity: row.entity,
          entityId: row.entityId,
          summary: row.summary,
          before: safeParse(row.before),
          after: safeParse(row.after),
        })),
        hasMore,
        total,
        actors: actorRows
          .filter((a) => a.userId !== null)
          .map((a) => ({ id: a.userId as string, name: a.actor ?? (a.userId as string) })),
      },
    };
  } catch {
    return { ok: false, error: "Could not load the audit log. Please try again." };
  }
}

/** The module/action vocabularies, for building the filter dropdowns. */
export async function getAuditVocabulary(): Promise<
  MutationResult<{
    modules: { value: AuditModule; label: string }[];
    actions: { value: AuditAction; label: string; module: AuditModule }[];
  }>
> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
  return {
    ok: true,
    data: {
      modules: AUDIT_MODULES.map((value) => ({
        value,
        label: AUDIT_MODULE_LABELS[value] ?? value,
      })),
      actions: (Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((value) => ({
        value,
        label: AUDIT_ACTION_LABELS[value],
        module: ACTION_MODULES[value],
      })),
    },
  };
}

/** The distinct actors present in the log, for the "user" filter dropdown. */
export type AuditActor = { id: string; name: string };

/** Parse a stored JSON snapshot, tolerating null/blank/legacy junk. */
function safeParse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // A malformed snapshot must not blank the whole log row — the summary
    // column is still the most important part of the entry.
    return null;
  }
}
