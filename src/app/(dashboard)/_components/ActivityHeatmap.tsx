/**
 * Peak-sales-hours heatmap for the dashboard's "Activity by time" card.
 *
 * Pure presentational Server Component: the dashboard page pre-computes a
 * 7 (days, Monday-first) × 8 (3-hour slots) count matrix from `prisma.sale`
 * timestamps and hands it down with the window's max cell count for scaling.
 * Each cell's indigo intensity is `count / maxCell`, rendered via inline
 * `rgba(...)` so the palette stays exactly in the redesign's indigo family
 * without depending on generated Tailwind shade classes.
 */

export default function ActivityHeatmap({
  matrix,
  maxCell,
}: {
  /** 7 rows (Mon..Sun) × 8 columns (3-hour slots) of sale counts. */
  matrix: number[][];
  /** Largest cell count in the window — scales every cell's intensity. */
  maxCell: number;
}) {
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const SLOTS = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"];
  const hasActivity = maxCell > 0;

  return (
    <div role="img" aria-label="Peak sales hours by day of week">
      {!hasActivity ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-700">
          <p className="text-sm text-slate-400">
            No sales to chart in this window.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-9 gap-1.5">
          {/* Corner + slot headers */}
          <span className="rounded-md bg-slate-800/60 text-[10px] font-semibold leading-none text-slate-500">
            {"\u00a0"}
          </span>
          {SLOTS.map((slot) => (
            <span
              key={slot}
              className="rounded-md bg-slate-800/60 text-center text-[9px] font-semibold leading-none text-slate-400"
            >
              {slot}
            </span>
          ))}

          {/* One row per day: day label + 8 intensity cells */}
          {matrix.map((cells, dayIndex) => (
            <>
              <span className="flex w-9 items-center justify-center rounded-md bg-slate-800/60 text-[10px] font-semibold leading-none text-slate-300">
                {DAYS[dayIndex]}
              </span>
              {cells.map((count, slotIndex) => {
                const ratio = count / maxCell;
                const alpha = 0.1 + 0.9 * ratio;
                const cell = `${DAYS[dayIndex]} ${SLOTS[slotIndex]}`;
                return (
                  <span
                    key={slotIndex}
                    title={`${cell} — ${count} sale${count === 1 ? "" : "s"}`}
                    aria-label={`${cell}: ${count} sale${count === 1 ? "" : "s"}`}
                    className="flex w-full items-center justify-center rounded-md text-[10px] font-semibold tabular-nums"
                    style={{
                      backgroundColor:
                        count > 0
                          ? `rgba(99, 102, 241, ${alpha.toFixed(2)})` // indigo-500
                          : "rgba(30, 41, 59, 0.35)", // slate-800
                    }}
                  >
                    {count > 0 ? count : ""}
                  </span>
                );
              })}
            </>
          ))}
        </div>
      )}
    </div>
  );
}