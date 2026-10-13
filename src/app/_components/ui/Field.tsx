/**
 * Labeled form-field wrapper shared across the dashboard dialogs so the
 * markup stays DRY. Renders a compact uppercase micro-label (with an optional
 * required marker) above its children.
 *
 * Phase 7 Step 7: `hint` adds a short plain-language explanation under the
 * control (e.g. what a SKU is for), and `error` renders a per-field message in
 * the same rose style as `FormError` — so "which field needs attention" is
 * answered next to the field itself, not only in a form-level banner.
 */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  /** Short explanation shown under the control, e.g. "Must be unique." */
  hint?: React.ReactNode;
  /** Per-field validation message; renders with `role="alert"` under the control. */
  error?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
      >
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children}
      {hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Shared light input styling with an accessible indigo focus treatment. */
export const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-500 hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

export const selectCls =
  "w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm transition hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

/*
 * Shared dialog chrome, so every modal's footer reads identically: a neutral
 * outlined Cancel on the left, a solid indigo primary action on the right.
 */
export const dialogPrimaryCls =
  "inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/25 transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none";

export const dialogSecondaryCls =
  "inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

/** Inline validation/error callout used by every dialog form. */
export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
    >
      <span aria-hidden>⚠</span>
      <span>{children}</span>
    </p>
  );
}
