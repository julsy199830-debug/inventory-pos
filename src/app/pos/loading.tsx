/**
 * POS loading skeleton.
 *
 * Streamed automatically by the router while `pos/page.tsx` (an async Server
 * Component awaiting its Prisma queries) is rendering. Mirrors the register's
 * split-screen shell — header → catalog toolbar + product tiles on the left,
 * cart skeleton on the right — so the register feels instant instead of
 * hanging on the DB read. `animate-pulse` (Tailwind) gives the shimmer.
 */
export default function PosLoading() {
  return (
    <div
      className="flex h-screen w-full flex-col bg-slate-50"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="h-9 w-40 rounded-lg bg-slate-200 animate-pulse" />
          <div className="hidden h-4 w-28 rounded bg-slate-200 animate-pulse md:block" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-8 w-36 rounded-full bg-slate-200 animate-pulse" />
          <div className="hidden h-8 w-24 rounded-full bg-slate-100 animate-pulse sm:block" />
          <div className="h-8 w-20 rounded-lg border border-slate-200/80 bg-white animate-pulse" />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Product catalog */}
        <section className="flex flex-1 flex-col overflow-hidden border-r border-slate-200/80">
          {/* Toolbar skeleton */}
          <div className="border-b border-slate-200/80 bg-slate-50 px-6 py-4">
            <div className="flex items-center gap-2">
              <div className="h-10 w-56 rounded-xl border border-slate-200/80 bg-white shadow-sm animate-pulse" />
              <div className="h-8 w-20 rounded-full bg-slate-200 animate-pulse" />
              <div className="hidden h-8 w-20 rounded-full bg-slate-200 animate-pulse sm:block" />
              <div className="hidden h-8 w-24 rounded-full bg-slate-200 animate-pulse sm:block" />
            </div>
          </div>

          {/* Product grid skeleton */}
          <div className="overflow-y-auto p-6">
            <div className="mb-3 h-4 w-28 rounded bg-slate-200 animate-pulse" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  key={i}
                  className="min-h-[116px] rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm animate-pulse"
                >
                  <div className="h-3.5 w-4/5 rounded bg-slate-200 animate-pulse" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-slate-200 animate-pulse" />
                  <div className="mt-3 h-5 w-2/3 rounded bg-slate-200 animate-pulse" />
                  <div className="mt-2 h-3 w-1/3 rounded bg-slate-200 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Cart skeleton */}
        <aside className="hidden w-[360px] shrink-0 flex-col bg-white lg:flex lg:w-[400px]">
          <div className="border-b border-slate-200/80 px-6 py-4">
            <div className="h-5 w-36 rounded bg-slate-200 animate-pulse" />
          </div>
          <div className="border-b border-slate-200/80 px-6 py-4">
            <div className="h-3 w-24 rounded bg-slate-200 animate-pulse" />
            <div className="mt-2 h-10 w-full rounded-xl border border-slate-200/80 bg-white animate-pulse" />
          </div>
          <div className="border-b border-slate-200/80 px-6 py-4">
            <div className="h-3 w-20 rounded bg-slate-200 animate-pulse" />
            <div className="mt-2 h-10 w-full rounded-xl border border-slate-200/80 bg-white animate-pulse" />
          </div>
          <div className="flex-1 space-y-3 px-6 py-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="h-3.5 w-4/5 rounded bg-slate-200 animate-pulse" />
                  <div className="mt-2 h-3 w-1/3 rounded bg-slate-200 animate-pulse" />
                </div>
                <div className="h-8 w-24 rounded-lg bg-slate-200 animate-pulse" />
                <div className="h-4 w-12 rounded bg-slate-200 animate-pulse" />
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200/80 px-6 py-4">
            <div className="space-y-2">
              <div className="h-3.5 w-2/3 rounded bg-slate-200 animate-pulse" />
              <div className="h-3.5 w-1/2 rounded bg-slate-200 animate-pulse" />
            </div>
            <div className="mt-4 h-14 rounded-xl bg-slate-900/10 animate-pulse" />
            <div className="mt-3 h-12 w-full rounded-xl bg-emerald-600/40 animate-pulse" />
          </div>
        </aside>
      </div>
    </div>
  );
}