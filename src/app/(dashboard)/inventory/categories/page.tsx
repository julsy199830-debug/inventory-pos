import {
  EmptyState,
  PageHeader,
  TableCard,
  TableHead,
} from "@/app/_components/ui/PageHeader";
import { prisma } from "@/lib/db";
import { LOW_STOCK_THRESHOLD } from "@/lib/types";
import AddCategoryDialog from "./AddCategoryDialog";
import DeleteCategoryButton from "./DeleteCategoryButton";
import EditCategoryDialog from "./EditCategoryDialog";

type CategoryRow = {
  id: string;
  name: string;
  /** Per-category low-stock cutoff. Override of the app-wide default. */
  lowStockThreshold: number;
  /** Count of products linked to this category, for the "Products" column. */
  productCount: number;
};

/**
 * Categories management page.
 *
 * The governed inventory view over `Category`: a server-rendered table of every
 * category with its product count, low-stock threshold, and rename/delete
 * controls. This is the page the inventory product form depends on (the managed
 * `<select>` draws from this set), and the page whose cutoff the inventory
 * badges honor (via {@link stockStatusAt} + the category's `lowStockThreshold`).
 *
 * Sibling in shape to the suppliers page (header → Add trigger → table), but
 * leaner: the category set is small, so there's no text-search box and no
 * `searchParams` plumbing — just a sorted table. Each row's Add/Edit/Delete are
 * small client islands so the confirm + pending state have somewhere to live;
 * everything else stays a pure Server Component.
 *
 * On any mutation the server actions revalidate both `/inventory/categories`
 * and `/inventory`, so edits here re-flow into the product-form dropdown and
 * the inventory badges with no manual refetch.
 */
export default async function CategoriesPage() {
  // Fetched in parallel: the categories (with linked product counts) and the
  // total for the header. Direct server-side Prisma queries, safe in a Server
  // Component — `_count` is the relation aggregate that gives us the N each
  // category's Products relation holds without an N+1.
  const [rows, total] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    }),
    prisma.category.count(),
  ]);

  const categories: CategoryRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    lowStockThreshold: c.lowStockThreshold,
    productCount: c._count.products,
  }));

  return (
    <div className="space-y-6">
      {/* Phase 7 Step 4: title → description → count → primary action. */}
      <PageHeader
        back={{ href: "/inventory", label: "Back to inventory" }}
        helpId="categories"
        title="Categories"
        description="Organize your catalog. Each category sets its own low-stock threshold (default 10)."
        meta={
          <>
            <span className="font-medium text-slate-900">
              {total.toLocaleString()}
            </span>{" "}
            categor{total === 1 ? "y" : "ies"}
          </>
        }
        actions={
          <AddCategoryDialog />
        }
      />

      {/* Data table */}
      <TableCard label="Categories">
        <TableHead>
                <th className="px-5 py-3 font-medium">Category Name</th>
                <th className="px-5 py-3 font-medium">Products</th>
                <th className="px-5 py-3 font-medium">Low-stock threshold</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
            </TableHead>
            <tbody className="divide-y divide-slate-200/80">
              {categories.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-5 py-3">
                    <ProductCountPill count={c.productCount} />
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.lowStockThreshold}
                    {c.lowStockThreshold !== LOW_STOCK_THRESHOLD && (
                      <span className="ml-1.5 text-xs text-slate-500">
                        (default {LOW_STOCK_THRESHOLD})
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <EditCategoryDialog
                        category={{
                          id: c.id,
                          name: c.name,
                          lowStockThreshold: c.lowStockThreshold,
                        }}
                      />
                      <DeleteCategoryButton
                        id={c.id}
                        name={c.name}
                        productCount={c.productCount}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      title="No categories yet."
                      body="Add one to start grouping your inventory."
                    />
                  </td>
                </tr>
              )}
            </tbody>
      </TableCard>
    </div>
  );
}

/** Small pill showing how many products are linked to this category. Mirrors the
 *  suppliers page's count pill so the two "N products" affordances read alike. */
function ProductCountPill({ count }: { count: number }) {
  const color =
    count === 0
      ? "bg-slate-100 text-slate-600"
      : "bg-indigo-50 text-indigo-700";
  const label = count === 1 ? "1 product" : `${count} products`;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}
