import { PageHeader } from "@/app/_components/ui/PageHeader";

/**
 * The administrative audit log (Phase 1e).
 *
 * A Server Component: it reads the filters straight from the URL search params,
 * loads the first page server-side, and hands both to {@link AuditLogClient}.
 * That means a filtered view is shareable, bookmarkable and reloadable, and the
 * page renders its first 100 rows with no client round-trip.
 *
 * RBAC: `getAuditLogs` enforces ADMIN/MANAGER itself, so a CASHIER who navigates
 * here directly gets the action's refusal message rather than a page of data.
 */
import AuditLogClient, { type AuditFilters } from "./AuditLogClient";
import { getAuditLogs, getAuditVocabulary, type AuditLogRow } from "./actions";

/** Read one search param as a trimmed string (searchParams values can be arrays). */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters: AuditFilters = {
    query: first(sp.q),
    module: first(sp.module),
    action: first(sp.action),
    userId: first(sp.user),
    from: first(sp.from),
    to: first(sp.to),
  };

  const [result, vocabulary] = await Promise.all([
    getAuditLogs(filters),
    getAuditVocabulary(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        helpId="audit-log"
        title="Audit log"
        description="A record of who changed what, and when. Entries are append-only — they are never edited or removed."
        meta={
          <>
            Showing{" "}
            <span className="font-medium text-slate-900">
              {result.ok ? result.data.total.toLocaleString() : "—"}
            </span>{" "}
            entries
          </>
        }
      />

      {result.ok ? (
        <AuditLogClient
          initialRows={result.data.rows}
          initialQuery={filters.query}
          total={result.data.total}
          hasMore={result.data.hasMore}
          actors={result.data.actors}
          modules={vocabulary.ok ? vocabulary.data.modules : []}
          actions={vocabulary.ok ? vocabulary.data.actions : []}
          activeFilters={{
            module: filters.module,
            action: filters.action,
            userId: filters.userId,
            from: filters.from,
            to: filters.to,
          }}
        />
      ) : (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {result.error}
        </p>
      )}
    </div>
  );
}

export type { AuditLogRow };
