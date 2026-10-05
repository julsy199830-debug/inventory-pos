/**
 * Phase 6 — the ONE place money, tax, dates and times are formatted.
 *
 * Before this module every page carried its own `toLocaleString("en-PH", …)`
 * or hardcoded `"₱"`, so changing the store's currency in Settings changed some
 * screens and silently left others behind. Everything now routes through here.
 *
 * This file is deliberately PURE: no database, no server-only import, no React.
 * That lets a Server Component, a client island and a unit test all use the same
 * code, which is the only way "one shared convention" is actually enforceable.
 * Server Components load the row with `getFormatSettings()` from
 * `./store-config`; client components receive an already-resolved
 * {@link FormatSettings} object as a prop.
 *
 * Nothing here writes to the database or decides a business rule. Historical
 * amounts are formatted, never recomputed.
 */

import { round2 } from "./analytics";

/** The subset of `StoreSetting` that formatting needs. */
export type FormatSettings = {
  currencySymbol: string;
  currencyCode: string;
  locale: string;
  /** Sales-tax percentage, e.g. `8` means 8%. */
  taxRate: number;
  taxEnabled: boolean;
  dateFormat: string;
  timeFormat: string;
};

/**
 * Used when no settings row exists yet (fresh install) and as the fallback for
 * any field that is blank. These match the migration's column defaults, so a
 * database that has never been configured formats identically to one whose
 * Settings form was left untouched.
 */
export const DEFAULT_FORMAT: FormatSettings = {
  currencySymbol: "₱",
  currencyCode: "PHP",
  locale: "en-PH",
  taxRate: 0,
  taxEnabled: true,
  dateFormat: "MMM D, YYYY",
  timeFormat: "h:mm a",
};

/** Date patterns the Settings form offers. An unknown token falls back safely. */
export const DATE_FORMATS = [
  "MMM D, YYYY",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
] as const;

/** Time patterns the Settings form offers. */
export const TIME_FORMATS = ["h:mm a", "HH:mm"] as const;

/**
 * Normalise a possibly-partial/possibly-null settings row into a complete
 * {@link FormatSettings}.
 *
 * Every field is coerced rather than trusted: a blank `currencySymbol` falls
 * back, and a non-numeric tax rate becomes 0 instead of rendering "NaN" across
 * the app.
 */
export function resolveFormat(
  raw:
    | (Partial<FormatSettings> & { locale?: string | null })
    | null
    | undefined,
): FormatSettings {
  const symbol = raw?.currencySymbol?.trim();
  const locale = raw?.locale?.trim();
  const dateFormat = raw?.dateFormat?.trim();
  const timeFormat = raw?.timeFormat?.trim();
  const rate = Number(raw?.taxRate);

  return {
    currencySymbol: symbol || DEFAULT_FORMAT.currencySymbol,
    currencyCode: raw?.currencyCode?.trim() || DEFAULT_FORMAT.currencyCode,
    locale: locale || DEFAULT_FORMAT.locale,
    taxRate: Number.isFinite(rate) ? rate : 0,
    taxEnabled: raw?.taxEnabled ?? DEFAULT_FORMAT.taxEnabled,
    dateFormat: DATE_FORMATS.includes(dateFormat as never)
      ? (dateFormat as string)
      : DEFAULT_FORMAT.dateFormat,
    timeFormat: TIME_FORMATS.includes(timeFormat as never)
      ? (timeFormat as string)
      : DEFAULT_FORMAT.timeFormat,
  };
}
// ── Money ─────────────────────────────────────────────────────────────────────

/**
 * The grouping/decimal part of a money value, WITHOUT any currency symbol.
 *
 * `Intl` with `style: "currency"` would hardcode the symbol for the locale, which
 * defeats the point — an operator who sets "RM" must see "RM", not "RM" only by
 * accident. So we let `Intl` own the NUMBER (thousands separators and decimal
 * marks follow `locale`) and attach the configured symbol ourselves.
 */
function formatAmount(value: number, s: FormatSettings): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat(s.locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    // An invalid BCP-47 tag must not blank the whole screen.
    return safe.toFixed(2);
  }
}

/**
 * Render money with the store's currency symbol.
 *
 * Negative amounts keep the sign in front of the symbol ("-₱50.00"), which is
 * the convention every one of these screens already used.
 */
export function formatMoney(
  value: number,
  s: FormatSettings = DEFAULT_FORMAT,
): string {
  const safe = Number.isFinite(value) ? value : 0;
  const body = formatAmount(Math.abs(safe), s);
  const sign = safe < 0 ? "-" : "";
  return `${sign}${s.currencySymbol}${body}`;
}

/** Plain number, no symbol — for quantities, point counts and percentages. */
export function formatNumber(
  value: number,
  s: FormatSettings = DEFAULT_FORMAT,
): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat(s.locale).format(safe);
  } catch {
    return String(safe);
  }
}

// ── Tax ───────────────────────────────────────────────────────────────────────

/**
 * The tax rate actually in force.
 *
 * Zero when the store has switched tax OFF **or** when the rate is 0. Preserving
 * the old "`taxRate = 0` means no tax" behaviour is what keeps every existing
 * sale and every existing store correct — the new `taxEnabled` flag is additive,
 * it never overrides a rate of 0 into a non-zero tax.
 */
export function effectiveTaxRate(s: FormatSettings = DEFAULT_FORMAT): number {
  if (!s.taxEnabled) return 0;
  return Number.isFinite(s.taxRate) && s.taxRate > 0 ? s.taxRate : 0;
}

/** Tax owed on `amount`, rounded to cents. Zero when tax is disabled. */
export function computeTax(
  amount: number,
  s: FormatSettings = DEFAULT_FORMAT,
): number {
  const rate = effectiveTaxRate(s);
  if (rate === 0 || !Number.isFinite(amount)) return 0;
  return round2((amount * rate) / 100);
}

/** A tax rate as a display string, e.g. "8%" or "Off". */
export function formatTaxRate(s: FormatSettings = DEFAULT_FORMAT): string {
  const rate = effectiveTaxRate(s);
  return rate === 0 ? "Off" : `${trimNumber(rate)}%`;
}
// ── Dates & times ─────────────────────────────────────────────────────────────

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Drop a trailing ".0" so a whole-number rate reads "8%" not "8.0%". */
function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round2(n));
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Render a date using the store's configured pattern.
 *
 * Implemented as explicit token substitution rather than `toLocaleDateString`
 * because `Intl` cannot express "DD/MM/YYYY" as a fixed pattern — its
 * `en-GB`/`en-US` locales silently disagree with the operator's intent.
 */
export function formatDate(
  value: Date | string | number | null | undefined,
  s: FormatSettings = DEFAULT_FORMAT,
): string {
  const d = toDate(value);
  if (!d) return "—";
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const monthShort = MONTHS_SHORT[d.getMonth()];

  switch (s.dateFormat) {
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    case "DD/MM/YYYY":
      return `${dd}/${mm}/${yyyy}`;
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "MMM D, YYYY":
    default:
      return `${monthShort} ${d.getDate()}, ${yyyy}`;
  }
}

/** Render a time using the store's configured 12h/24h clock. */
export function formatTime(
  value: Date | string | number | null | undefined,
  s: FormatSettings = DEFAULT_FORMAT,
): string {
  const d = toDate(value);
  if (!d) return "—";
  const h24 = d.getHours();
  const mm = pad(d.getMinutes());
  if (s.timeFormat === "HH:mm") return `${pad(h24)}:${mm}`;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${ampm}`;
}

/** Date and time together, for receipts and statement rows. */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  s: FormatSettings = DEFAULT_FORMAT,
): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDate(d, s)} · ${formatTime(d, s)}`;
}