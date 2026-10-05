"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { StoreSetting } from "@/generated/prisma/client";
import type { ActionResult } from "@/lib/types";
import { roleGuardError } from "@/lib/session";
import {
  DATE_FORMATS,
  TIME_FORMATS,
} from "@/lib/format";

/** Staff-only guard — settings are store-wide configuration. */
const STAFF_ROLES = ["ADMIN", "MANAGER"] as const;

async function staffGuardError(): Promise<string | null> {
  return roleGuardError(STAFF_ROLES);
}

/**
 * `load` reads a `FormData` field as a string and coerces an empty/whitespace
 * value to `undefined`, so a missing field is treated as "absent" rather than
 * the literal empty string. Field values arrive as `FormDataEntryValue | null`,
 * so we stringify booleans/files away (unwanted here) before trimming.
 *
 * Mirrors the helper in the suppliers actions — kept local rather than shared so
 * each action module stays self-contained.
 */
function load(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (raw == null) return undefined;
  const str = String(raw).trim();
  return str === "" ? undefined : str;
}

/**
 * Server-side data shape for the settings row. The page reads this to prefill the
 * form; it's the raw DB row, so the nullable fields are `string | null`. The
 * page/form coalesces null → "" at the input layer (same convention as the
 * supplier edit dialog), so an em-dash placeholder never round-trips.
 */
export type StoreSettingsData = Pick<
  StoreSetting,
  | "storeName"
  | "address"
  | "phone"
  | "taxRate"
  | "currencySymbol"
  | "updatedAt"
  // Phase 6 — the global formatting/identity configuration. These are the same
  // columns `src/lib/format.ts` reads, so editing them here changes every
  // screen in the app rather than one page.
  | "taxEnabled"
  | "locale"
  | "currencyCode"
  | "dateFormat"
  | "timeFormat"
  | "email"
  | "receiptFooter"
>;

/**
 * Result shape for `saveSettings`. The form observes it with a manual `await`
 * (event-handler calling convention, not `useActionState`).
 *
 * The shared discriminated {@link ActionResult} with no success payload
 * (`ActionResult<void>` reads back as `{ ok: true } | { ok: false; error }`).
 * `ok: true` carries nothing: `revalidatePath('/settings')` refreshes the
 * cached row, so the "last edited" stamp and form values stream back in on the
 * next render without the client merging anything.
 */
export type SaveSettingsResult = ActionResult<void>;

/**
 * The single store-settings row this app keeps. Settings are a 1-row table by
 * design (the schema comment on `StoreSetting` spells out why), so we never
 * `findMany`; the first row — if any — is the settings. Returned as-is (fields
 * may be null) for the page to prefill.
 */
export async function getStoreSettings(): Promise<StoreSettingsData | null> {
  const row = await prisma.storeSetting.findFirst();
  if (!row) return null;
  return {
    storeName: row.storeName,
    address: row.address,
    phone: row.phone,
    taxRate: row.taxRate,
    currencySymbol: row.currencySymbol,
    updatedAt: row.updatedAt,
    taxEnabled: row.taxEnabled,
    locale: row.locale,
    currencyCode: row.currencyCode,
    dateFormat: row.dateFormat,
    timeFormat: row.timeFormat,
    email: row.email,
    receiptFooter: row.receiptFooter,
  };
}

/**
 * Save the store-wide settings — the store's tax rate and currency symbol here
 * are intended to drive POS checkout and receipts (today those are hardcoded
 * constants; this externalizes them so a manager can change them without a
 * deploy).
 *
 * This is a singleton upsert: at most one row should ever exist, and the saved
 * values *are* the settings, so there is no `id` to thread. We resolve the
 * existing row (if any) and update it, or create it on the first save. A race
 * between two concurrent first-saves could in principle create two rows; that's
 * acceptable for a single-manager admin screen and the page only ever reads the
 * first, so the extra row is invisible (and corrected on the next save, which
 * updates the first row it finds).
 *
 * Like every Server Action, this is reachable by anyone who can POST to the app
 * — validation is enforced here on the server, not just in the form. We never
 * trust the client to have run it.
 *
 * `updatedAt` is a plain `DateTime` in the schema (not `@updatedAt`) so it only
 * moves on an explicit write — we bump it manually here, and the page reads
 * "last edited" from it without Prisma touching it on unrelated writes.
 */
export async function saveSettings(
  // Invoked directly from the form's submit handler rather than `useActionState`,
  // so there is no `(prevState, formData)` signature to honor. The page is
  // refreshed by revalidatePath, so there is no client state to merge anyway.
  formData: FormData,
): Promise<SaveSettingsResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
  const storeName = load(formData, "storeName");
  const address = load(formData, "address");
  const phone = load(formData, "phone");
  const taxRateRaw = load(formData, "taxRate");
  const currencySymbol = load(formData, "currencySymbol");
  // ── Phase 6: the global formatting/identity fields ─────────────────────────
  const email = load(formData, "email");
  const receiptFooter = load(formData, "receiptFooter");
  const locale = load(formData, "locale") ?? "en-PH";
  const currencyCode = (load(formData, "currencyCode") ?? "PHP").toUpperCase();
  const dateFormat = load(formData, "dateFormat") ?? "MMM D, YYYY";
  const timeFormat = load(formData, "timeFormat") ?? "h:mm a";
  // An unchecked checkbox is absent from FormData entirely, so "missing" means
  // OFF. `load()` is therefore NOT used here: it would map "off" to undefined,
  // which is the same thing, but the intent is clearer stated directly.
  const taxEnabled = formData.get("taxEnabled") === "on";

  // Reject anything the shared formatter does not actually support, rather than
  // silently storing a value that would fall back to a default at render time.
  // `DATE_FORMATS`/`TIME_FORMATS` are the single source of truth for what the
  // UI offers; this is the server refusing anything else.
  if (!DATE_FORMATS.includes(dateFormat as (typeof DATE_FORMATS)[number])) {
    return { ok: false, error: "Choose one of the listed date formats." };
  }
  if (!TIME_FORMATS.includes(timeFormat as (typeof TIME_FORMATS)[number])) {
    return { ok: false, error: "Choose one of the listed time formats." };
  }
  // A locale that `Intl` cannot parse would make every amount fall back to a
  // bare number at render time, so it is rejected here rather than discovered
  // on the till.
  try {
    new Intl.NumberFormat(locale);
  } catch {
    return { ok: false, error: "That locale is not recognised." };
  }
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    return { ok: false, error: "Currency code must be 3 letters, e.g. PHP." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (receiptFooter && receiptFooter.length > 200) {
    return { ok: false, error: "Receipt footer must be 200 characters or fewer." };
  }

  // ── Required-field & shape validation (server-authoritative) ───────────────
  if (!storeName) {
    return { ok: false, error: "Store name is required." };
  }

  // Tax rate is required (it can be 0 to disable tax, but it must be provided).
  if (taxRateRaw === undefined) {
    return { ok: false, error: "Tax rate is required." };
  }
  const taxRate = Number(taxRateRaw);
  // Finite, numeric, and in [0, 100] — anything outside is either a typo or a
  // tampered payload. `Number("")` is 0 but `load` already turned "" into
  // undefined above, so an empty field is caught as "required", not silently 0.
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    return { ok: false, error: "Tax rate must be a number between 0 and 100." };
  }

  // Currency symbol defaults to "₱" in the schema, but once submitted we keep
  // whatever the manager chose. Cap it tight — it's a glyph, not free text — so
  // a runaway paste can't blow up receipts/layout. A blank is allowed and falls
  // back to "₱" on save.
  const symbol = currencySymbol ?? "₱";
  if (symbol.length > 8) {
    return {
      ok: false,
      error: "Currency symbol must be 8 characters or fewer.",
    };
  }

  // ── Upsert the singleton row ───────────────────────────────────────────────
  try {
    const existing = await prisma.storeSetting.findFirst({ select: { id: true } });
    const updatedAt = new Date();
    // One payload for both branches so an update and a first-create cannot drift
    // apart — the Phase 6 fields were exactly the kind of thing that gets added
    // to `update` and forgotten in `create`.
    const data = {
      storeName,
      address,
      phone,
      email,
      receiptFooter,
      // Round to one decimal to dodge float noise (8.5, not 8.499999…).
      taxRate: Math.round(taxRate * 10) / 10,
      taxEnabled,
      currencySymbol: symbol,
      locale,
      currencyCode,
      dateFormat,
      timeFormat,
      updatedAt,
    };
    if (existing) {
      await prisma.storeSetting.update({ where: { id: existing.id }, data });
    } else {
      await prisma.storeSetting.create({ data });
    }
  } catch {
    // Any failure (constraint, adapter error) is surfaced as a generic, leak-free
    // message so internals never reach the client, and nothing is rethrown so
    // the UI stays usable.
    return { ok: false, error: "Could not save the settings. Please try again." };
  }

  revalidatePath("/settings");
  // Phase 6: these settings are GLOBAL. `src/lib/format.ts` is read by the POS,
  // receipts, the dashboard, every report, inventory, purchasing, employees,
  // customers and suppliers — so the paths that render money are revalidated
  // too. Revalidating only `/settings` left the till showing the old currency
  // until a hard refresh, which is precisely the bug this feature exists to fix.
  for (const path of [
    "/pos",
    "/",
    "/inventory",
    "/reports",
    "/reports/analytics",
    "/accounting",
    "/purchasing",
    "/employees",
    "/dtr",
    "/customers",
    "/suppliers",
    "/my-transactions",
  ]) {
    revalidatePath(path);
  }
  return { ok: true };
}
