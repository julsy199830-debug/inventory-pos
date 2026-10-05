/**
 * Phase 6 — global store settings: one formatter, one convention.
 *
 * These are pure-function tests on purpose. `src/lib/format.ts` has no database
 * and no React, which is exactly what makes it enforceable: if formatting were
 * entangled with a page, "the same settings everywhere" would be a hope rather
 * than something a test could pin.
 *
 * Covered: the configured symbol (not the locale default), locale grouping,
 * negative signs, tax disabled / rate-0 (the pre-Phase-6 rule), every supported
 * date and time pattern, and graceful fallbacks for blank or garbage input.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_FORMAT,
  computeTax,
  effectiveTaxRate,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTaxRate,
  formatTime,
  resolveFormat,
  type FormatSettings,
} from "@/lib/format";

/** A store configured for a non-Peso, non-PH locale: proves nothing is hardcoded. */
const malaysia: FormatSettings = resolveFormat({
  currencySymbol: "RM",
  currencyCode: "MYR",
  locale: "en-MY",
  taxRate: 6,
  taxEnabled: true,
  dateFormat: "DD/MM/YYYY",
  timeFormat: "HH:mm",
});

// ── Money ─────────────────────────────────────────────────────────────────────

test("formatMoney uses the configured symbol, not the locale default", () => {
  assert.equal(formatMoney(1234.5, malaysia), "RM1,234.50");
  assert.equal(formatMoney(1234.5, DEFAULT_FORMAT), "₱1,234.50");
});

test("formatMoney survives a symbol that Intl would never produce", () => {
  const odd = resolveFormat({ currencySymbol: "US$", locale: "en-US" });
  assert.equal(formatMoney(9.99, odd), "US$9.99");
});

test("formatMoney keeps the sign in front of the symbol for negatives", () => {
  assert.equal(formatMoney(-50, DEFAULT_FORMAT), "-₱50.00");
  assert.equal(formatMoney(-50, malaysia), "-RM50.00");
});

test("formatMoney renders non-finite input as zero rather than NaN", () => {
  assert.equal(formatMoney(Number.NaN, DEFAULT_FORMAT), "₱0.00");
  assert.equal(formatMoney(Number.POSITIVE_INFINITY, DEFAULT_FORMAT), "₱0.00");
});
// ── Tax ───────────────────────────────────────────────────────────────────────

test("effectiveTaxRate is zero when tax is disabled even if a rate is stored", () => {
  const off = resolveFormat({ taxRate: 8, taxEnabled: false });
  assert.equal(effectiveTaxRate(off), 0);
  assert.equal(formatTaxRate(off), "Off");
  assert.equal(computeTax(1000, off), 0);
});

test("a stored rate of 0 still means no tax (pre-Phase-6 rule preserved)", () => {
  const zeroRate = resolveFormat({ taxRate: 0, taxEnabled: true });
  assert.equal(effectiveTaxRate(zeroRate), 0);
  assert.equal(computeTax(1000, zeroRate), 0);
});

test("computeTax applies the configured rate and rounds to cents", () => {
  assert.equal(computeTax(1000, malaysia), 60); // 6% of 1000
  assert.equal(computeTax(199.99, malaysia), 12); // 11.9994 -> 12
  assert.equal(computeTax(1000, DEFAULT_FORMAT), 0); // default rate is 0
});

test("formatTaxRate drops a trailing zero decimal", () => {
  assert.equal(
    formatTaxRate(resolveFormat({ taxRate: 8, taxEnabled: true })),
    "8%",
  );
  assert.equal(
    formatTaxRate(resolveFormat({ taxRate: 8.5, taxEnabled: true })),
    "8.5%",
  );
});

// ── Dates & times ─────────────────────────────────────────────────────────────

const SAMPLE = new Date(2026, 2, 5, 14, 7, 0); // 5 Mar 2026, 14:07 local

test("every supported date pattern renders as documented", () => {
  const at = (pattern: string) =>
    formatDate(SAMPLE, resolveFormat({ dateFormat: pattern }));
  assert.equal(at("MMM D, YYYY"), "Mar 5, 2026");
  assert.equal(at("DD/MM/YYYY"), "05/03/2026");
  assert.equal(at("MM/DD/YYYY"), "03/05/2026");
  assert.equal(at("YYYY-MM-DD"), "2026-03-05");
});

test("an unsupported date pattern falls back instead of rendering a token", () => {
  const s = resolveFormat({ dateFormat: "WAT" });
  assert.equal(formatDate(SAMPLE, s), "Mar 5, 2026");
});

test("time honours 12h and 24h clocks", () => {
  assert.equal(
    formatTime(SAMPLE, resolveFormat({ timeFormat: "HH:mm" })),
    "14:07",
  );
  assert.equal(
    formatTime(SAMPLE, resolveFormat({ timeFormat: "h:mm a" })),
    "2:07 PM",
  );
  // Midnight and noon are the classic 12-hour clock traps.
  assert.equal(
    formatTime(new Date(2026, 0, 1, 0, 30), resolveFormat({ timeFormat: "h:mm a" })),
    "12:30 AM",
  );
  assert.equal(
    formatTime(new Date(2026, 0, 1, 12, 0), resolveFormat({ timeFormat: "h:mm a" })),
    "12:00 PM",
  );
});

test("date and time render together in one call", () => {
  assert.equal(
    formatDateTime(
      SAMPLE,
      resolveFormat({ dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" }),
    ),
    "2026-03-05 · 14:07",
  );
});

test("an absent or unparseable date renders an em dash, not 'Invalid Date'", () => {
  assert.equal(formatDate(null, DEFAULT_FORMAT), "—");
  assert.equal(formatDate("not-a-date", DEFAULT_FORMAT), "—");
  assert.equal(formatTime(undefined, DEFAULT_FORMAT), "—");
});

// ── Fallbacks ─────────────────────────────────────────────────────────────────

test("resolveFormat fills every gap from the defaults", () => {
  assert.deepEqual(resolveFormat(null), DEFAULT_FORMAT);
});

test("blank strings fall back rather than producing empty output", () => {
  const s = resolveFormat({ currencySymbol: "   ", locale: "", dateFormat: "" });
  assert.equal(s.currencySymbol, DEFAULT_FORMAT.currencySymbol);
  assert.equal(s.locale, DEFAULT_FORMAT.locale);
  assert.equal(s.dateFormat, DEFAULT_FORMAT.dateFormat);
  assert.equal(formatMoney(5, s), "₱5.00");
});

test("a non-numeric tax rate becomes 0, never NaN", () => {
  const s = resolveFormat({ taxRate: Number.NaN });
  assert.equal(s.taxRate, 0);
  assert.equal(computeTax(500, s), 0);
});

test("an invalid locale tag degrades gracefully instead of throwing", () => {
  const s = resolveFormat({ locale: "not a locale!!" });
  assert.doesNotThrow(() => formatMoney(1234.5, s));
  assert.match(formatMoney(1234.5, s), /1,234\.50|1234\.50/);
});

test("formatNumber omits the currency symbol and keeps grouping", () => {
  assert.equal(formatNumber(1234567, DEFAULT_FORMAT), "1,234,567");
});