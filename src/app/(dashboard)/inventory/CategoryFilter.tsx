'use client';

import { useTransition } from 'react';
import type { CategoryOption } from './AddProductDialog';

/**
 * Category filter dropdown. onChange submits the enclosing GET form so the
 * selection drives the URL searchParams and the Server Component re-renders
 * with the narrowed rows. We pull the current value from the select itself
 * (defaultValue is set by the server), so we don't need to mirror it here.
 *
 * Options are valued by category `id` (the URL carries `?category=<id|all>`),
 * matching the page's server-side filter, which now narrows by `categoryId`
 * rather than the old free-text `category` string column. The "All categories"
 * option uses the `"all"` sentinel the page treats as "no filter".
 */
export default function CategoryFilter({
  categories,
  active,
}: {
  categories: CategoryOption[];
  /** Either `"all"` (no filter) or a category id the page resolved from the URL. */
  active: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      name="category"
      defaultValue={active}
      disabled={pending}
      onChange={(e) => {
        // Swap the select's own value, then submit the parent form.
        const form = e.currentTarget.form;
        if (form) startTransition(() => form.requestSubmit());
      }}
      className="rounded-xl border border-slate-200/80 bg-white shadow-sm px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600/10 disabled:opacity-60"
    >
      <option value="all">All categories</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
