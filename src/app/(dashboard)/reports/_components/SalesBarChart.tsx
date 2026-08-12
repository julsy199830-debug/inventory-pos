"use client";

import { useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { SalesVolumePoint } from "../actions";
import {
  INDIGO,
  EMERALD,
  SLATE_300,
  SLATE_500,
  formatMoney,
  formatMoneyAxis,
} from "./chart-theme";

/**
 * Stacked sales-volume bar chart — the centrepiece of the analytics page.
 *
 * Two stacked series per bucket: **Cash** (emerald-600) vs **Card / Credit**
 * (emerald-500), with the top segment's corners rounded. The Month / Week
 * toggle is client-side state over the two datasets the server action already
 * computed, so switching periods never refetches. Both series share a
 * `stackId` so a zero Cash month still shows the Card / Credit segment (and
 * vice-versa) instead of floating bars.
 */
export default function SalesBarChart({
  monthly,
  weekly,
  currencySymbol = "₱",
}: {
  monthly: SalesVolumePoint[];
  weekly: SalesVolumePoint[];
  currencySymbol?: string;
}) {
  const [period, setPeriod] = useState<"month" | "week">("month");
  const data = period === "month" ? monthly : weekly;
  const hasSales = data.some((point) => point.cash > 0 || point.cardCredit > 0);

  return (
    <section className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Sales Volume</h2>
          <p className="text-sm text-slate-500">
            Revenue by payment method —{" "}
            {period === "month" ? "last 6 months" : "last 8 weeks"}.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          <PeriodButton active={period === "month"} onClick={() => setPeriod("month")}>
            Monthly
          </PeriodButton>
          <PeriodButton active={period === "week"} onClick={() => setPeriod("week")}>
            Weekly
          </PeriodButton>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-5 text-sm text-slate-600">
        <LegendChip color={INDIGO} label="Cash" />
        <LegendChip color={EMERALD} label="Card / Credit" />
      </div>

      <div className="mt-4 h-72">
        {hasSales ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              barCategoryGap="28%"
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={SLATE_300}
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: SLATE_300 }}
                tick={{ fill: SLATE_500, fontSize: 12 }}
                dy={6}
                interval={0}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={58}
                tick={{ fill: SLATE_500, fontSize: 12 }}
                tickFormatter={(value: number) =>
                  formatMoneyAxis(value, currencySymbol)
                }
              />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                content={<VolumeTooltip currencySymbol={currencySymbol} />}
              />
              {/* Rendered first = bottom segment; the last Bar is the top of
                  the stack, so it carries the rounded `radius` corners. */}
              <Bar
                dataKey="cash"
                name="Cash"
                stackId="sales"
                fill={INDIGO}
                maxBarSize={42}
              />
              <Bar
                dataKey="cardCredit"
                name="Card / Credit"
                stackId="sales"
                fill={EMERALD}
                maxBarSize={42}
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200">
            <p className="text-sm text-slate-500">
              No completed sales in this window yet.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function PeriodButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-white text-emerald-600 shadow-sm"
          : "text-slate-500 hover:text-slate-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-[3px]"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/** White-card hover tooltip listing both stacked series + the bucket total. */
function VolumeTooltip({
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
  const total = payload.reduce(
    (sum, entry) => sum + (typeof entry.value === "number" ? entry.value : 0),
    0,
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {payload.map((entry, i) => (
        <p
          key={i}
          className="mt-1 flex items-center gap-1.5 text-sm text-slate-700"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-medium">{entry.name}</span>
          <span className="ml-auto pl-4 font-semibold text-slate-900">
            {formatMoney(Number(entry.value ?? 0), currencySymbol)}
          </span>
        </p>
      ))}
      <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-xs font-semibold text-slate-900">
        Total {formatMoney(total, currencySymbol)}
      </p>
    </div>
  );
}
