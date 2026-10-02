/**
 * `/my-activity` loading skeleton.
 *
 * This route sits OUTSIDE the `(dashboard)` group (a CASHIER is redirected away
 * from every management route, and this is their screen), so it inherits no
 * dashboard skeleton — it needs its own or the page streams in behind a blank
 * slate. The shapes mirror the real page: header bar, the status card with its
 * punch controls, then the shift list.
 *
 * The status line is a skeleton rather than text on purpose: "On the clock since
 * 09:12" is a payroll claim, and a placeholder must never imply one.
 */
export default function MyActivityLoading() {
  return (
    <div className="min-h-screen bg-slate-50" aria-busy="true" aria-live="polite">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-4 w-28 rounded bg-slate-100 animate-pulse" />
              <div className="h-2.5 w-20 rounded bg-slate-100 animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-20 rounded-lg border border-slate-200 bg-white animate-pulse" />
            <div className="h-8 w-24 rounded-lg bg-indigo-600/60 animate-pulse" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        {/* Status + punch controls */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="h-3 w-16 rounded bg-slate-100 animate-pulse" />
              <div className="h-5 w-56 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-40 rounded bg-slate-100 animate-pulse" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-20 rounded-lg bg-indigo-600/60 animate-pulse" />
              <div className="h-8 w-24 rounded-lg bg-amber-50 animate-pulse" />
            </div>
          </div>
        </section>

        {/* Shift list */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="h-4 w-24 rounded bg-slate-100 animate-pulse" />
            <div className="mt-2 h-3 w-40 rounded bg-slate-100 animate-pulse" />
          </div>
          <ul className="divide-y divide-slate-100">
            {ROWS.map((row) => (
              <li
                key={row}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="space-y-1.5">
                  <div className="h-3.5 w-44 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-20 rounded bg-slate-100 animate-pulse" />
                </div>
                <div className="h-3.5 w-12 rounded bg-slate-100 animate-pulse" />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

/** Placeholder shift rows. */
const ROWS = Array.from({ length: 5 }, (_, i) => i);