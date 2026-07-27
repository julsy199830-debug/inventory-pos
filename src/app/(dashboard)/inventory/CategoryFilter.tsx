'use client';

import { useTransition } from 'react';

/**
 * Category filter dropdown. onChange submits the enclosing GET form so the
 * selection drives the URL searchParams and the Server Component re-renders
 * with the narrowed rows. We pull the current value from the select itself
 * (defaultValue is set by the server), so we don't need to mirror it here.
 */
export default function CategoryFilter({
  categories,
  active,
}: {
  categories: string[];
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
      className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60"
    >
      <option value="all">All categories</option>
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
