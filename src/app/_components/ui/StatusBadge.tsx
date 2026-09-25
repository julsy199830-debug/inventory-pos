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
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-1 ring-red-200",
  info: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
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