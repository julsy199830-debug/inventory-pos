import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Phase 7 Step 4 — the single page-header pattern for every management page.
 *
 * Each page must answer, in this order:
 *
 *   1. Where am I?          -> `title` (the one h1)
 *   2. What is this page for? -> `description` (one plain-language line)
 *   3. What can I do here?   -> `actions` (primary first, top-right)
 *   4. Where do I click next? -> primary action stays reachable at 390px
 *
 * One component instead of a dozen hand-rolled headers so the hierarchy
 * cannot drift again. The `actions` slot wraps below the title on narrow
 * screens (primary action first in DOM order, so it stays reachable), and
 * destructive controls are never passed here — they live on rows/dialogs.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  back,
}: {
  /** Page name — rendered as the single h1. */
  title: ReactNode;
  /** One plain-language line: what this page is for. */
  description?: ReactNode;
  /** Supporting facts (counts, ranges). Renders under the description. */
  meta?: ReactNode;
  /** Primary action first, then secondary. Pinned right on desktop. */
  actions?: ReactNode;
  /** Optional back link (detail pages: `Customers → Customer Account`).
   * Either a ready-made node or a `{ href, label }` shorthand that renders as
   * the standard "← label" link. */
  back?: ReactNode | { href: string; label: string };
}) {
  const backHref =
    typeof back === "object" && back !== null && "href" in back
      ? (back as { href: string; label: string })
      : null;
  return (
    <div className="space-y-3">
      {back ? (
        <div className="flex flex-wrap items-center gap-2">
          {backHref ? (
            <Link
              href={backHref.href}
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-700"
            >
              <span aria-hidden>←</span>
              {backHref.label}
            </Link>
          ) : (
            back as ReactNode
          )}
        </div>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm text-slate-500">{description}</p>
          ) : null}
          {meta ? (
            <div className="text-sm text-slate-500">{meta}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {actions}
          </div>
        ) : null}
      </header>
    </div>
  );
}

/**
 * Standard filter row: search + selects + date inputs in one wrapping band.
 *
 * Placement matches the page pattern (below the header, above the table) on
 * every list page. `children` are the controls; the row wraps instead of
 * overflowing on narrow screens. Server GET forms keep their own `<form>`
 * wrapper — this is layout only, never logic.
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="page-filters"
      className="flex flex-wrap items-end gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      {children}
    </div>
  );
}

/**
 * Standard table shell: one border, one header style, one scroll container.
 * Keeps every list table's chrome identical without touching columns or data.
 */
export function TableCard({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
      </div>
    </div>
  );
}

/** Shared thead row style: small caps slate on a slate-50 band. */
export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
        {children}
      </tr>
    </thead>
  );
}

/**
 * Standard empty state: what this is, why it is empty, what to do next.
 * The optional `action` (e.g. Add Product) makes the next step one click.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-5 py-12 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/**
 * Shared form-section shell for the light Step 4 grouping pass: a titled
 * band with a short hint, so long forms scan as Basic → Pricing → Stock.
 * Visual only — no validation or field changes.
 */
export function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </h3>
        {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
