/**
 * Dashboard route-group loading skeleton.
 *
 * Streamed automatically by the router into the `(dashboard)` layout's
 * <main> while any dashboard `page.tsx` (an async Server Component awaiting
 * its Prisma queries) is rendering. The sidebar stays live — this only
 * replaces the content column — and the structure mirrors the common page
 * shape (breadcrumb → header → toolbar → table card), so settling into real
 * content is a fade rather than a layout jump.
 * `animate-pulse` (Tailwind) gives the gentle breathing shimmer.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {/* Breadcrumb placeholder */}
      <div className="flex items-center gap-2">
        <div className="h-4 w-20 rounded bg-slate-200 animate-pulse" />
        <div className="h-3.5 w-3.5 rounded bg-slate-200 animate-pulse" />
        <div className="h-4 w-28 rounded bg-slate-200 animate-pulse" />
      </div>

      {/* Page header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-56 rounded-md bg-slate-200 animate-pulse" />
          <div className="h-4 w-40 rounded bg-slate-200 animate-pulse" />
        </div>
        <div className="h-10 w-40 rounded-xl bg-indigo-600/60 animate-pulse" />
      </header>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-10 w-full max-w-sm rounded-xl border border-slate-200/80 bg-white shadow-sm animate-pulse" />
        <div className="h-10 w-28 rounded-xl border border-slate-200/80 bg-white shadow-sm animate-pulse" />
      </div>

      {/* Data table card */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">
                  <div className="h-3 w-16 rounded bg-slate-200 animate-pulse" />
                </th>
                <th className="px-5 py-3 font-medium">
                  <div className="h-3 w-24 rounded bg-slate-200 animate-pulse" />
                </th>
                <th className="px-5 py-3 font-medium">
                  <div className="h-3 w-20 rounded bg-slate-200 animate-pulse" />
                </th>
                <th className="px-5 py-3 font-medium">
                  <div className="h-3 w-16 rounded bg-slate-200 animate-pulse" />
                </th>
                <th className="px-5 py-3 font-medium">
                  <div className="h-3 w-16 rounded bg-slate-200 animate-pulse" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROWS.map((row) => (
                <tr key={row}>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-20 rounded bg-slate-200 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-44 rounded bg-slate-200 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-20 rounded bg-slate-200 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-5 w-20 rounded-full bg-slate-200 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-5 w-24 rounded-full bg-slate-200 animate-pulse" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Number of placeholder rows to render. Six gives the table visible body
 *  without overflowing a typical viewport. */
const ROWS = Array.from({ length: 6 }, (_, i) => i);