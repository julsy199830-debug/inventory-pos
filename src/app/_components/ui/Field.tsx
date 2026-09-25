/**
 * Labeled form-field wrapper shared across the dashboard dialogs so the
 * markup stays DRY. Renders a compact uppercase micro-label (with an optional
 * required marker) above its children.
 */
export function Field({
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
        className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
      >
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children}
    </div>
  );
}

/** Shared light input styling with an accessible indigo focus treatment. */
export const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

export const selectCls =
  "w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm transition hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
