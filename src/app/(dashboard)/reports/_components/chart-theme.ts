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

/**
 * Phase 6: money formatting is owned by `@/lib/format`. These two remain only
 * as the names the report charts already import, so the chart components did not
 * all have to change shape in one go. Both delegate — there is no second copy of
 * the formatting logic left in this file.
 */
import {
  formatMoneyCompact,
  formatMoney as formatMoneyShared,
  DEFAULT_FORMAT,
  type FormatSettings,
} from "@/lib/format";

/** Format a money value for tooltips and tables: ₱1,234.56. */
export function formatMoney(
  amount: number,
  format: FormatSettings = DEFAULT_FORMAT,
): string {
  return formatMoneyShared(amount, format);
}

/** Compact money for chart axes — ₱12k / ₱1.2M. */
export function formatMoneyAxis(
  amount: number,
  format: FormatSettings = DEFAULT_FORMAT,
): string {
  return formatMoneyCompact(amount, format);
}
