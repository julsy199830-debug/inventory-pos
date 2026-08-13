/**
 * Shared color palette + money formatters for the Recharts widgets in
 * `_components/`. The hex values mirror the Tailwind emerald/mint/slate
 * tokens used across the dashboard (emerald-600 `#059669`, emerald-500
 * `#10b981`, …) so the SVG charts and the Tailwind UI agree on color.
 *
 * Plain module (no `"use client"`): it's only ever imported from chart
 * components, so the constants ship in their client chunks; the handful of
 * server-side imports (TopProductsTable, analytics page) just use the pure
 * formatters.
 */

export const EMERALD_600 = "#059669"; // emerald-600
export const EMERALD = "#10b981"; // emerald-500
export const EMERALD_SOFT = "#34d399"; // emerald-400
export const MINT = "#6ee7b7"; // emerald-300
export const SLATE_300 = "#cbd5e1";
export const SLATE_400 = "#94a3b8";
export const SLATE_500 = "#64748b";

/** Donut slice palette — emerald/mint/slate family only, cycled for stores
 * with more categories than colors (three seeded categories fit exactly). */
export const DONUT_PALETTE = [
  EMERALD_600,
  EMERALD,
  SLATE_400,
  EMERALD_SOFT,
  MINT,
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
