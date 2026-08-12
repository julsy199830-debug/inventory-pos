"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import type { OrderTrendPoint } from "../actions";
import { EMERALD, INDIGO, SLATE_300 } from "./chart-theme";

const strokeByColor = {
  indigo: INDIGO,
  emerald: EMERALD,
} as const;

/**
 * Smooth area sparkline of daily order counts — the mini trend behind a KPI
 * tile. Axis-free by design (it's a tile footer, not an analysis chart); the
 * hover tooltip carries the day label + count. `useId()` keeps the SVG
 * gradient id unique per instance so two tiles can coexist on one page.
 */
export default function OrdersSparkline({
  data,
  color = "indigo",
  height = 64,
}: {
  data: OrderTrendPoint[];
  color?: "indigo" | "emerald";
  height?: number;
}) {
  const gradientId = useId().replace(/:/g, "");
  const stroke = strokeByColor[color];
  const hasOrders = data.some((point) => point.orders > 0);

  if (!hasOrders) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ minHeight: height }}
      >
        <p className="text-xs text-slate-400">No orders yet</p>
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            content={<SparklineTooltip />}
            cursor={{ stroke: SLATE_300, strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="orders"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3, fill: stroke, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SparklineTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: number | string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0].value ?? 0);
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-lg">
      <p className="text-xs font-semibold text-slate-900">
        {label}: {value.toLocaleString()}{" "}
        {value === 1 ? "order" : "orders"}
      </p>
    </div>
  );
}
