/**
 * Shared color palette + money formatters for the Recharts widgets in
 * `_components/`. The hex values mirror the Tailwind blue/sky/slate
 * tokens used across the dashboard (blue-600 `#2563eb`, sky-400 `#38bdf8`, …)
 * so the SVG charts and the Tailwind UI agree on color.
 *
 * Plain module (no `"use client"`): it's only ever imported from chart
 * components, so the constants ship in their client chunks; the handful of
 * server-side imports (TopProductsTable, analytics page) just use the pure
 * formatters.
 */

export const BLUE_600 = "#2563eb"; // blue-600
export const blue = "#2563eb";      // alias for simple imports
export const SKY_400 = "#38bdf8"; // sky-400
export const BLUE_500 = "#3b82f6"; // blue-500
export const BLUE_400 = "#60a5fa"; // blue-400
export const SLATE_300 = "#cbd5e1";
export const SLATE_400 = "#94a3b8";
export const SLATE_500 = "#64748b";

/** Donut slice palette — blue/sky/slate family only, cycled for stores
 * with more categories than colors (three seeded categories fit exactly). */
export const DONUT_PALETTE = [
  BLUE_600,
  SKY_400,
  SLATE_400,
  BLUE_500,
  BLUE_400,
  SLATE_500,
] as const;

/** Format a money value for tooltips and tables: ₱1,234.56. */
export function formatMoney(amount: number, symbol = "₱"): string {
  const body = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "-" : ""}${symbol}${body}`;
}

/** Compact money for chart axes — ₱12k / ₱1.2M. Drops the trailing `.0` so
 * axis labels stay short and readable. */
export function formatMoneyAxis(amount: number, symbol = "₱"): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${sign}${symbol}${trimZero((abs / 1_000_000).toFixed(1))}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${symbol}${trimZero((abs / 1_000).toFixed(1))}k`;
  }
  return `${sign}${symbol}${Math.round(abs)}`;
}

function trimZero(value: string): string {
  return value.replace(/\.0$/, "");
}
