/**
 * Categories loading skeleton.
 *
 * Streamed automatically by the router while the categories `page.tsx` (an
 * async Server Component awaiting its Prisma queries) is rendering. Mirrors the
 * inventory loader's structure (header → controls → table) so settling into the
 * real content is a fade rather than a layout jump; `animate-pulse` (Tailwind)
 * gives the gentle breathing shimmer.
 */
export default function CategoriesLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-40 rounded-md bg-slate-200 animate-pulse" />
          <div className="h-4 w-28 rounded bg-slate-200 animate-pulse" />
        </div>
      </header>

      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-4 w-64 rounded bg-slate-200 animate-pulse" />
        {/* Add Category button */}
        <div className="h-10 w-36 rounded-lg bg-blue-600 animate-pulse" />
      </div>

      {/* Data table */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Category Name</th>
                <th className="px-5 py-3 font-medium">Products</th>
                <th className="px-5 py-3 font-medium">Low-stock threshold</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROWS.map((row) => (
                <tr key={row}>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-32 rounded bg-slate-200 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-5 w-20 rounded-full bg-slate-200 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-12 rounded bg-slate-200 animate-pulse" />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="ml-auto h-7 w-16 rounded-md bg-slate-200 animate-pulse" />
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

/** Number of placeholder rows. Six reads as "loading a list" without overflowing
 *  a typical viewport — the category set is small, so six is plenty. */
const ROWS = Array.from({ length: 6 }, (_, i) => i);
