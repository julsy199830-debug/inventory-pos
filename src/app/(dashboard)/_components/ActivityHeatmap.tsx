/**
 * Peak-sales-hours heatmap for the dashboard's "Activity by time" card.
 *
 * Pure presentational Server Component: the dashboard page pre-computes a
 * 7 (days, Monday-first) × 8 (3-hour slots) count matrix from `prisma.sale`
 * timestamps and hands it down with the window's max cell count for scaling.
 *
 * The 3-hour bucketing is the dashboard's own (`Math.floor(hours / 3)` in
 * `buildHeatmap`), so `SLOTS` is display-only and must stay in 1:1 order with
 * that bucketing: midnight, 3a, 6a, 9a, noon, 3p, 6p, 9p. Nothing here feeds
 * back into how the numbers are counted.
 *
 * Each cell's indigo intensity is `count / maxCell`, rendered via inline
 * `rgba(...)` so the ramp stays exactly in the indigo family without
 * depending on generated Tailwind shade classes. Because the app's theme is
 * light, the ramp floor is tuned against white surfaces and the numeral only
 * flips to white once the fill is dark enough to need the contrast.
 *
 * Cells carry an explicit height so a day with no sales still renders a full
 * row — otherwise all-zero rows would collapse and the grid would look ragged.
 *
 * The card is a third of the dashboard's bottom row, which leaves only ~20px
 * per column — too narrow for a single-line "12 AM". Each header therefore
 * stacks the hour over its meridiem (12 / AM), the standard compact axis
 * treatment: all eight markers stay visible at a readable size, with nothing
 * truncated and no horizontal scrolling. The `overflow-x-auto` shell is kept as
 * a last-resort fallback for very narrow viewports.
 */
import { Fragment } from "react";

/**
 * Hour + meridiem for the eight 3-hour slots, midnight → 9 PM. Display only —
 * must stay in 1:1 order with the dashboard's `Math.floor(hours / 3)` bucketing.
 */
const SLOTS: { hour: string; meridiem: string; label: string }[] = [
  { hour: "12", meridiem: "AM", label: "12 AM" },
  { hour: "3", meridiem: "AM", label: "3 AM" },
  { hour: "6", meridiem: "AM", label: "6 AM" },
  { hour: "9", meridiem: "AM", label: "9 AM" },
  { hour: "12", meridiem: "PM", label: "12 PM" },
  { hour: "3", meridiem: "PM", label: "3 PM" },
  { hour: "6", meridiem: "PM", label: "6 PM" },
  { hour: "9", meridiem: "PM", label: "9 PM" },
];

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
  const hasActivity = maxCell > 0;

  return (
    <div role="img" aria-label="Peak sales hours by day of week">
      {!hasActivity ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60">
          <p className="text-sm text-slate-500">
            No sales to chart in this window.
          </p>
        </div>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="grid min-w-[13rem] grid-cols-[1.75rem_repeat(8,minmax(0,1fr))] gap-1">
            {/* Corner spacer + the eight slot headers */}
            <span aria-hidden="true" className="h-7" />
            {SLOTS.map((slot) => (
              <span
                key={slot.label}
                title={slot.label}
                className="flex flex-col items-center justify-center leading-[1.15]"
              >
                <span className="text-[10px] font-semibold tracking-tight text-slate-600">
                  {slot.hour}
                </span>
                <span className="text-[8px] font-medium tracking-tight text-slate-400">
                  {slot.meridiem}
                </span>
              </span>
            ))}

            {/* One row per day: day label + 8 intensity cells */}
            {matrix.map((cells, dayIndex) => (
              <Fragment key={dayIndex}>
                <span className="flex h-8 items-center justify-center text-[10px] font-semibold leading-none text-slate-600">
                  {DAYS[dayIndex]}
                </span>
                {cells.map((count, slotIndex) => {
                  const slot = SLOTS[slotIndex];
                  const ratio = count / maxCell;
                  // Light-theme ramp: a pale indigo floor still reads as "some
                  // activity" against white, topping out at solid indigo-500.
                  const alpha = 0.16 + 0.84 * ratio;
                  const cell = `${DAYS[dayIndex]} ${slot?.label ?? slotIndex}`;
                  const sold = `${count} sale${count === 1 ? "" : "s"}`;
                  return (
                    <span
                      key={slotIndex}
                      title={count > 0 ? `${cell} — ${sold}` : `${cell} — no sales`}
                      aria-label={`${cell}: ${sold}`}
                      className={[
                        "flex h-8 items-center justify-center rounded-md text-[10px] font-semibold tabular-nums ring-1 ring-inset",
                        // Dark fills need the light numeral; pale fills keep the
                        // slate one so the number stays legible either way.
                        count > 0 && ratio > 0.55
                          ? "text-white ring-transparent"
                          : "text-slate-700 ring-slate-900/5",
                      ].join(" ")}
                      style={{
                        backgroundColor:
                          count > 0
                            ? `rgba(99, 102, 241, ${alpha.toFixed(2)})` // indigo-500
                            : "rgba(148, 163, 184, 0.18)", // slate-400, faint
                      }}
                    >
                      {count > 0 ? count : ""}
                    </span>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}