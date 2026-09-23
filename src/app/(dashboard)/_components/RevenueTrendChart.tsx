"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  formatMoney,
  formatMoneyAxis,
} from "@/app/(dashboard)/reports/_components/chart-theme";

/** One point of the revenue trend series — a date/month bucket + its total. */
export type TrendPoint = {
  label: string;
  revenue: number;
};

/* Dark-theme chart tokens. These hex values mirror the redesign's slate-800
 * grid, slate-400 ticks, and indigo/violet accents (Tailwind indigo-500
 * `#6366f1`, violet-500 `#8b5cf6`) so the SVG chart and the surrounding
 * charcoal cards agree on color. */
const INDIGO = "#6366f1";
const VIOLET = "#8b5cf6";
const GRID = "#1e293b"; // slate-800
const TICK = "#94a3b8"; // slate-400

/**
 * Revenue trend area chart for the dashboard's Analytics card.
 *
 * A single violet-stroked, indigo-filled area over the caller-supplied time
 * buckets (callers build day buckets for Week/Month and month buckets for
 * Year). Purely presentational: the Server Component pre-computes the series
 * from `prisma.sale`, so this stays a thin client island with no refetching.
 * The axis interval widens for dense (monthly-daily) series so labels don't
 * collide.
 */
export default function RevenueTrendChart({
  data,
  currencySymbol = "₱",
}: {
  data: TrendPoint[];
  currencySymbol?: string;
}) {
  const hasSales = data.some((point) => point.revenue > 0);
  // Show ~8 evenly spaced x labels regardless of bucket count (30-day series
  // can't label every point without collision).
  const interval = data.length > 8 ? Math.floor((data.length - 1) / 8) : 0;

  return (
    <div className="h-72">
      {!hasSales ? (
        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-700">
          <p className="text-sm text-slate-400">
            No completed sales in this window yet.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tick={{ fill: TICK, fontSize: 11 }}
              dy={6}
              interval={interval}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={54}
              tick={{ fill: TICK, fontSize: 11 }}
              tickFormatter={(value: number) => formatMoneyAxis(value, currencySymbol)}
            />
            <Tooltip
              cursor={{ stroke: INDIGO, strokeWidth: 1, strokeDasharray: "4 4" }}
              content={<TrendTooltip currencySymbol={currencySymbol} />}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              name="Revenue"
              stroke={VIOLET}
              strokeWidth={2.5}
              fill={INDIGO}
              fillOpacity={0.16}
              activeDot={{ r: 5, fill: INDIGO, stroke: VIOLET, strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Charcoal tooltip card so the hover readout matches the dark dashboard. */
function TrendTooltip({
  active,
  payload,
  label,
  currencySymbol,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string;
    value?: number;
    color?: string;
  }>;
  label?: string | number;
  currencySymbol: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-slate-300">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
        {formatMoney(Number(value), currencySymbol)}
      </p>
    </div>
  );
}