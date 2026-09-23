/**
 * Labeled form-field wrapper shared across the dashboard dialogs so the
 * markup stays DRY. Renders an uppercase micro-label (with an optional
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
        className="block text-xs font-medium uppercase tracking-wide text-slate-400"
      >
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

/** Shared input styling — dark surfaces, consistent radii, indigo focus ring. */
export const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-950/60 shadow-sm px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:bg-slate-900 disabled:text-slate-500";
