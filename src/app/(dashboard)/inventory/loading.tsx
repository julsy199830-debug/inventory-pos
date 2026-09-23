/**
 * Inventory loading skeleton.
 *
 * Streamed automatically by the router while the inventory `page.tsx` (an
 * async Server Component awaiting its Prisma queries) is rendering. The
 * router wraps the page segment in a <Suspense> boundary and swaps this in as
 * the fallback, so navigation feels instant instead of hanging on the DB read.
 *
 * The structure deliberately mirrors `page.tsx` (header â†’ controls â†’ table),
 * so settling into the real content is a fade rather than a layout jump.
 * `animate-pulse` (Tailwind) gives the gentle breathing shimmer.
 */

export default function InventoryLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-56 rounded-lg bg-slate-800 animate-pulse" />
          <div className="h-4 w-40 rounded bg-slate-800 animate-pulse" />
        </div>
      </header>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* search input */}
        <div className="flex-1">
          <div className="h-10 w-full rounded-xl border border-slate-800 bg-slate-900 shadow-sm animate-pulse" />
        </div>
        {/* Filter button */}
        <div className="h-10 w-28 rounded-xl border border-slate-800 bg-slate-900 shadow-sm animate-pulse" />
        {/* Add New Product button */}
        <div className="h-10 w-44 rounded-lg bg-indigo-600 animate-pulse" />
      </div>

      {/* Data table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">SKU / Barcode</th>
                <th className="px-5 py-3 font-medium">Product Name</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Retail Price</th>
                <th className="px-5 py-3 font-medium">Cost Price</th>
                <th className="px-5 py-3 font-medium">Stock Level</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {ROWS.map((row) => (
                <tr key={row}>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-20 rounded bg-slate-800 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-44 rounded bg-slate-800 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-20 rounded bg-slate-800 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-16 rounded bg-slate-800 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-3.5 w-16 rounded bg-slate-800 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-5 w-20 rounded-full bg-slate-800 animate-pulse" />
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-5 w-24 rounded-full bg-slate-800 animate-pulse" />
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

/** Number of placeholder rows to render. Eight gives the table visible body
 *  without overflowing a typical viewport â€” enough to read as "loading a list"
 *  while staying cheap. */
const ROWS = Array.from({ length: 8 }, (_, i) => i);
