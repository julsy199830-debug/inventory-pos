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

export const BLUE_600 = "#4f46e5"; // indigo-600 — primary series
export const blue = "#4f46e5";      // alias for simple imports
export const SKY_400 = "#7c3aed"; // violet-600 — secondary series
export const BLUE_500 = "#c026d3"; // fuchsia-600 — tertiary series
export const BLUE_400 = "#0891b2"; // cyan-600 — highlight / sparkline
export const SLATE_300 = "#e2e8f0"; // light grid / axis lines
export const SLATE_400 = "#64748b"; // axis ticks / labels
export const SLATE_500 = "#475569"; // secondary text

/** Donut slice palette — blue/sky/slate family only, cycled for stores
 * with more categories than colors (three seeded categories fit exactly). */
export const DONUT_PALETTE = [
  BLUE_600, // indigo-500
  SKY_400, // violet-500
  BLUE_500, // fuchsia-500
  BLUE_400, // cyan-400
  "#a78bfa", // violet-400
  "#818cf8", // indigo-400
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
