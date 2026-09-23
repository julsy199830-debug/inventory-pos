/**
 * Reusable status badge for table rows (stock status, order status, etc.).
 * Variants map to semantic color tokens so callers don't hardcode colors.
 */
type StatusVariant =
  | "success" // Completed, In Stock, Active
  | "warning" // Low Stock, Pending
  | "danger" // Out of Stock, Refunded, Cancelled
  | "info"; // Processing, On Hold

const variantStyles: Record<StatusVariant, string> = {
  success: "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30",
  danger: "bg-red-500/10 text-red-300 ring-1 ring-red-500/30",
  info: "bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/30",
};

export function StatusBadge({
  children,
  variant = "info",
}: {
  children: React.ReactNode;
  variant?: StatusVariant;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantStyles[variant]}`}>
      {children}
    </span>
  );
}