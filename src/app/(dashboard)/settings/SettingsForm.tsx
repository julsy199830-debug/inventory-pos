"use client";

import { useState, type FormEvent } from "react";
import {
  saveSettings,
  type SaveSettingsResult,
  type StoreSettingsData,
} from "@/app/actions/settings";

/**
 * The store settings form — the interactive island on the Settings page.
 *
 * Sibling in spirit to the supplier dialogs: same hand-rolled Tailwind field
 * shell, `inputCls`, and `Field` wrapper. The biggest difference is that this is
 * a *page-level* form (not a modal), so there's no open/close state — just the
 * submit/error/pending trio.
 *
 * Like `EditSupplierDialog`, we submit via a manual async handler that `await`s
 * the raw `saveSettings` Server Action directly — `saveSettings` takes only the
 * `formData` (no `prevState`, since it's invoked from the event handler, not
 * `useActionState`). Server Actions are async functions that resolve to their
 * declared return type, so awaiting one gives us the result in the same tick.
 * (This is the "Event Handlers" calling convention from the mutating-data docs.)
 *
 * We deliberately don't use `useActionState` here. Its `(state, action,
 * pending)` triple is built for `<form action={...}>` wiring, and the idiomatic
 * way to react to its success is `setState` inside an effect keyed on `state` —
 * which `react-hooks/set-state-in-effect` flags as a derived-state cascade.
 * Calling the action ourselves sidesteps that entirely: the success UI lives in
 * the submit handler, where side effects belong, not in a render-following effect.
 *
 * `settings` may be `null` (no row yet — first visit). In that case we prefill
 * the inputs with sensible defaults rather than blanks, so the manager isn't
 * forced to retype everything to create the first row. The em-dash convention
 * from the supplier table doesn't apply here — these are form fields, so we
 * coalesce `null → ""` at the input layer (`defaultValue={settings?.address ?? ""}`)
 * exactly like the supplier edit dialog.
 *
 * The tax-rate and currency-symbol fields are *controlled* (the rest are
 * uncontrolled `defaultValue`) so the form can show live, client-side guards
 * before the round-trip — but the server action remains the source of truth and
 * re-validates everything, since a Server Action is just a POST endpoint to
 * anyone who can craft one.
 */
export default function SettingsForm({
  settings,
}: {
  /** The current settings row, or `null` if none exists yet. */
  settings: StoreSettingsData | null;
}) {
  // Drive `pending`/`error`/`saved` ourselves from the awaited action result
  // rather than reading them out of `useActionState` — same UX (inputs lock and
  // a confirmation shows while/after submitting), but no setState-in-effect.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Tax rate + currency symbol are controlled so we can mirror live guards. The
  // defaults here mirror the schema (`taxRate` defaults to 0, `currencySymbol`
  // to "$") for the no-row-yet case.
  const [taxRate, setTaxRate] = useState<string>(
    settings ? String(settings.taxRate) : "0",
  );
  const [currencySymbol, setCurrencySymbol] = useState<string>(
    settings?.currencySymbol ?? "$",
  );

  // Live client-side guards. These are advisory UX only — the server action
  // re-checks authoritatively — but they keep the submit button honest and give
  // the manager immediate feedback on a typo.
  const taxRateNum = Number(taxRate);
  const taxRateValid =
    taxRate.trim() !== "" &&
    Number.isFinite(taxRateNum) &&
    taxRateNum >= 0 &&
    taxRateNum <= 100;
  const currencySymbolValid = currencySymbol.length <= 8;
  const canSubmit = taxRateValid && currencySymbolValid && !pending;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const formData = new FormData(e.currentTarget);
    const result: SaveSettingsResult = await saveSettings(formData);
    setPending(false);
    if (result.ok) {
      setSaved(true);
      return;
    }
    setError(result.error ?? null);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {saved && !pending && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
        >
          Settings saved.
        </p>
      )}

      <Field label="Store name" htmlFor="storeName" required>
        <input
          id="storeName"
          name="storeName"
          type="text"
          required
          disabled={pending}
          defaultValue={settings?.storeName ?? ""}
          placeholder="e.g. OCA Market"
          className={inputCls}
        />
      </Field>

      <Field label="Address" htmlFor="address">
        <input
          id="address"
          name="address"
          type="text"
          disabled={pending}
          defaultValue={settings?.address ?? ""}
          placeholder="e.g. 100 Market St, NV 89101"
          className={inputCls}
        />
      </Field>

      <Field label="Phone" htmlFor="phone">
        <input
          id="phone"
          name="phone"
          type="tel"
          disabled={pending}
          defaultValue={settings?.phone ?? ""}
          placeholder="e.g. +1 555 0100"
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tax rate (%)" htmlFor="taxRate" required>
          <input
            id="taxRate"
            name="taxRate"
            type="number"
            step="0.1"
            min={0}
            max={100}
            required
            disabled={pending}
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
            aria-invalid={!taxRateValid}
            className={inputCls}
          />
          {!taxRateValid && (
            <p className="mt-1 text-xs text-red-600">
              Enter a number between 0 and 100.
            </p>
          )}
        </Field>

        <Field label="Currency symbol" htmlFor="currencySymbol" required>
          <input
            id="currencySymbol"
            name="currencySymbol"
            type="text"
            required
            maxLength={8}
            disabled={pending}
            value={currencySymbol}
            onChange={(e) => setCurrencySymbol(e.target.value)}
            aria-invalid={!currencySymbolValid}
            className={inputCls}
          />
          {!currencySymbolValid && (
            <p className="mt-1 text-xs text-red-600">
              Must be 8 characters or fewer.
            </p>
          )}
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:bg-zinc-50";

/** Labeled field wrapper — keeps the form DRY (matches the supplier dialogs). */
function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
