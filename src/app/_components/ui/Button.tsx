import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared button styles — the single source of truth for every action control.
 *
 * Variants:
 *   - `primary`: the ONE thing the user came to do (Save, Complete Sale, …)
 *   - `secondary`: Cancel / Back / Clear / Reset, and header back-links' sibling actions
 *   - `destructive`: Delete / Void / Refund (always behind a confirmation)
 *   - `ghost`: low-emphasis tertiary actions inside cards
 *   - `table`: compact View / Edit / Print / Export buttons inside table rows
 *
 * Sizes: `sm` (table rows, dense headers), `md` (default), `lg` (POS-scale CTAs).
 * Every combination keeps a visible `:focus-visible` ring, a disabled state, and
 * `aria-disabled` support via the native `disabled` prop. Callers prevent double
 * submission by disabling while their action is pending — the styles handle it.
 */

type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost" | "table";
type ButtonSize = "sm" | "md" | "lg";

const variantCls: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-600 text-white shadow-sm shadow-indigo-600/25 hover:bg-indigo-500 focus-visible:outline-indigo-500 disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none",
  secondary:
    "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-indigo-500 disabled:opacity-50",
  destructive:
    "bg-red-600 text-white shadow-sm shadow-red-600/25 hover:bg-red-500 focus-visible:outline-red-500 disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none",
  ghost:
    "text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-indigo-500 disabled:opacity-50",
  table:
    "border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline-indigo-500 disabled:opacity-50",
};

const sizeCls: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

const tableSizeCls: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-xs",
  lg: "h-9 px-4 text-sm",
};

const baseCls =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export function buttonCls(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
): string {
  const sizes = variant === "table" ? tableSizeCls : sizeCls;
  return `${baseCls} ${sizes[size]} ${variantCls[variant]}`;
}

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

/** Drop-in `<button>` with the shared styles. */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`${buttonCls(variant, size)} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

type ButtonLinkProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  href: string;
  children: ReactNode;
};

/** Drop-in `next/link` with the same shared styles. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  href,
  children,
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={`${buttonCls(variant, size)} ${className}`.trim()}
    >
      {children}
    </Link>
  );
}
