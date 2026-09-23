/**
 * Small icon button (pencil / trash) used in table row action cells.
 * Centralizes the hover/color styling so the inventory, categories, and
 * suppliers tables stay visually consistent.
 */
export function ActionIconButton({
  label,
  title,
  variant = "default",
  onClick,
  disabled,
  type = "button",
  children,
}: {
  label: string;
  title: string;
  variant?: "default" | "danger";
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  children: React.ReactNode;
}) {
  const tone =
    variant === "danger"
      ? "text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
      : "text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className={`inline-flex items-center justify-center rounded-md p-1.5 ${tone} disabled:opacity-50`}
    >
      {children}
    </button>
  );
}