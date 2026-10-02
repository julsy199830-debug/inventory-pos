/**
 * `/my-transactions` loading skeleton.
 *
 * Like `/my-activity`, this route is outside the `(dashboard)` group — it is the
 * cashier's own ledger, reachable without any management access — so it has no
 * inherited skeleton. The shapes mirror the real page: header, the GET filter
 * grid, then the sales list.
 */
export default function MyTransactionsLoading() {
  return (
    <div className="min-h-screen bg-slate-50" aria-busy="true" aria-live="polite">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-4 w-36 rounded bg-slate-100 animate-pulse" />
              <div className="h-2.5 w-20 rounded bg-slate-100 animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-20 rounded-lg border border-slate-200 bg-white animate-pulse" />
            <div className="h-8 w-20 rounded-lg bg-indigo-600/60 animate-pulse" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <div className="h-4 w-72 rounded bg-slate-100 animate-pulse" />

        {/* Filter grid */}
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          {FILTERS.map((f) => (
            <div key={f} className="space-y-1.5">
              <div className="h-2.5 w-14 rounded bg-slate-100 animate-pulse" />
              <div className="h-8 w-full rounded-lg border border-slate-200 bg-white animate-pulse" />
            </div>
          ))}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <div className="h-8 w-20 rounded-lg bg-indigo-600/60 animate-pulse" />
            <div className="ml-auto h-3 w-40 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>

        {/* Sales list */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
            <div className="mt-2 h-3 w-72 rounded bg-slate-100 animate-pulse" />
          </div>
          <ul className="divide-y divide-slate-100">
            {ROWS.map((row) => (
              <li
                key={row}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="space-y-1.5">
                  <div className="h-3.5 w-56 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-40 rounded bg-slate-100 animate-pulse" />
                </div>
                <div className="h-3.5 w-16 rounded bg-slate-100 animate-pulse" />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

/** Placeholder filter fields: search, from, to, status, payment. */
const FILTERS = ["Search", "From", "To", "Status", "Payment"];
/** Placeholder sale rows. */
const ROWS = Array.from({ length: 6 }, (_, i) => i);