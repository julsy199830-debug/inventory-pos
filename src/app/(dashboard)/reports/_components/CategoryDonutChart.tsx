"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { CategorySalesSlice } from "../actions";
import { DONUT_PALETTE, formatMoney } from "./chart-theme";

/**
 * Donut chart of revenue share by product category (last 30 days).
 *
 * Slice labels only render for segments ≥ 8% so tiny slices don't crowd each
 * other; the full percentage always lives in the legend list below and in the
 * hover tooltip. The centre overlays the 30-day revenue total — a div on top
 * of the SVG rather than an SVG `<text>` so it inherits the Tailwind
 * typography for free.
 */
export default function CategoryDonutChart({
  data,
  currencySymbol = "₱",
}: {
  data: CategorySalesSlice[];
  currencySymbol?: string;
}) {
  const total = data.reduce((sum, slice) => sum + slice.revenue, 0);

  return (
    <section className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          Category Share
        </h2>
        <p className="text-sm text-slate-500">Revenue mix — last 30 days.</p>
      </div>

      <div className="relative mt-4 h-64">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="revenue"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius="68%"
                outerRadius="92%"
                paddingAngle={2}
                cornerRadius={4}
                strokeWidth={0}
                label={(entry) => {
                  const percent = (entry as { percent?: number }).percent;
                  return percent !== undefined && percent >= 0.08
                    ? `${Math.round(percent * 100)}%`
                    : "";
                }}
                labelLine={false}
              >
                {data.map((slice, i) => (
                  <Cell
                    key={slice.category}
                    fill={DONUT_PALETTE[i % DONUT_PALETTE.length]}
                  />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip currencySymbol={currencySymbol} />} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200">
            <p className="text-sm text-slate-500">
              No sales to categorize yet.
            </p>
          </div>
        )}

        {data.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Total
            </p>
            <p className="text-lg font-semibold text-slate-900">
              {formatMoney(total, currencySymbol)}
            </p>
          </div>
        )}
      </div>

      {data.length > 0 && (
        <ul className="mt-4 space-y-2">
          {data.map((slice, i) => (
            <li
              key={slice.category}
              className="flex items-center gap-2.5 text-sm"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length],
                }}
              />
              <span className="truncate text-slate-600">{slice.category}</span>
              <span className="ml-auto font-semibold text-slate-900">
                {slice.percent.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DonutTooltip({
  active,
  payload,
  currencySymbol,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string;
    value?: number;
    color?: string;
    payload?: { percent?: number };
  }>;
  currencySymbol: string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const percent = entry.payload?.percent ?? 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: entry.color }}
        />
        {entry.name}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">
        {formatMoney(Number(entry.value ?? 0), currencySymbol)}
        <span className="ml-1.5 font-medium text-slate-500">
          ({percent.toFixed(1)}%)
        </span>
      </p>
    </div>
  );
}
