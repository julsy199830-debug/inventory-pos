/**
 * `/dtr` loading skeleton.
 *
 * Streamed into the `(dashboard)` layout's <main> while the page awaits its two
 * Prisma reads (shifts + corrections in the selected window). The dashboard's
 * own skeleton is a generic table; this one matches the DTR's actual shape —
 * title block, the From/To filter row, the shifts table, then the corrections
 * card — so settling into real content is a fade rather than a layout jump.
 *
 * Note the deliberate absence of the real total: a skeleton that renders a
 * plausible-looking "3 shifts · 24h 10m worked" would be inventing payroll
 * figures during a 200ms flash.
 */
export default function DtrLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {/* Page header + date filter */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-56 rounded-md bg-slate-100 animate-pulse" />
          <div className="h-4 w-64 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-9 w-36 rounded-lg border border-slate-200 bg-white shadow-sm animate-pulse" />
          <div className="h-9 w-36 rounded-lg border border-slate-200 bg-white shadow-sm animate-pulse" />
          <div className="h-9 w-20 rounded-lg bg-indigo-600/60 animate-pulse" />
        </div>
      </div>

      {/* Shifts table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
          <div className="mt-2 h-3 w-72 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                {["Employee", "Date", "Clock in", "Clock out", "Breaks", "Worked"].map(
                  (h) => (
                    <th key={h} className="px-4 py-2.5 font-semibold">
                      <div className="h-3 w-16 rounded bg-slate-200/70 animate-pulse" />
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROWS.map((row) => (
                <tr key={row}>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-24 rounded bg-slate-100 animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-20 rounded bg-slate-100 animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-14 rounded bg-slate-100 animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-14 rounded bg-slate-100 animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-16 rounded bg-slate-100 animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-14 rounded bg-slate-100 animate-pulse" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent corrections */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="h-4 w-40 rounded bg-slate-100 animate-pulse" />
        </div>
        <div className="space-y-3 px-4 py-4">
          {CORRECTION_ROWS.map((row) => (
            <div key={row} className="space-y-1.5">
              <div className="h-3.5 w-56 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-72 rounded bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Placeholder shift rows. */
const ROWS = Array.from({ length: 6 }, (_, i) => i);
/** Placeholder correction entries. */
const CORRECTION_ROWS = Array.from({ length: 2 }, (_, i) => i);