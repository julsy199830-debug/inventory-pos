import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonCls } from "./Button";

/**
 * Consistent return navigation for pages that sit outside the dashboard chrome
 * or one level below a list (detail pages, cashier screens).
 *
 * Rules:
 *   - Prefer this over `router.back()`: history is unreliable after a login
 *     redirect, a shared link, or a page refresh, so the `href` fallback is the
 *     predictable destination, not the exception.
 *   - Preserve list filters by passing the full href (e.g. `/my-transactions?status=x`).
 *   - Never point at a route the signed-in role cannot reach (cashiers never get
 *     a dashboard href; staff never get a bare register href).
 *   - Skip entirely when the sidebar, breadcrumbs, or POS header already answers
 *     "how do I return" — a second back link is clutter, not help.
 */
export function BackLink({
  href,
  label,
  preserveHref,
}: {
  /** Predictable fallback destination. */
  href: string;
  /** e.g. "Back to Dashboard", "Back to Transactions". */
  label: string;
  /**
   * Optional full href carrying the list's current query string so filters
   * survive the round trip. Falls back to `href` when absent.
   */
  preserveHref?: string;
}) {
  return (
    <Link
      href={preserveHref ?? href}
      className={buttonCls("secondary", "sm")}
      aria-label={label}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}
