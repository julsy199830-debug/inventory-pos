import Link from "next/link";
import { prisma } from "@/lib/db";
import AddProductDialog from "./AddProductDialog";
import CategoryFilter from "./CategoryFilter";
import DeleteProductButton from "./DeleteProductButton";
import EditProductDialog from "./EditProductDialog";

/** Sorting direction, ascending or descending. */
type Order = "asc" | "desc";

/** Allowable sort columns, keyed by the URL value. Sort is only ever applied to
 * Retail Price (price) and Stock Level (stock); any other ?sort= token falls
 * back to the default SKU ascending ordering. */
type SortField = "price" | "stock";
const SORT_FIELDS: Record<string, SortField> = {
  price: "price",
  stock: "stock",
};
const DEFAULT_ORDER: Order = "asc";

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  retail: string;
  cost: string;
  stock: number;
  /** Raw numeric retail price — used to prefill the edit dialog. */
  rawPrice: number;
  /** Raw numeric cost — used to prefill the edit dialog. */
  rawCost: number;
};

/** Format a number as USD currency, e.g. 199 -> "$199.00". */
function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default async function InventoryPage({
  searchParams,
}: {
  // searchParams is a Promise in this Next.js version — see the page file
  // convention docs on handling filtering with searchParams.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Awaited query-string filters: q is the text search, category narrows by
  // group, sort/order drive server-side column sorting. All are drawn from the
  // awaited Promise<searchParams> (see the page file convention docs).
  const { q = "", category = "all", sort, order } = await searchParams;
  const query = Array.isArray(q) ? q[0] ?? "" : q;
  const activeCategory = Array.isArray(category) ? category[0] ?? "all" : category;
  const rawSort = Array.isArray(sort) ? sort[0] : sort;
  const rawOrder = Array.isArray(order) ? order[0] : order;
  const sortField: SortField | undefined = rawSort ? SORT_FIELDS[rawSort] : undefined;
  const sortOrder: Order = rawOrder === "desc" ? "desc" : DEFAULT_ORDER;
  const term = query.trim().toLowerCase();

  // Fetched in parallel: the list of products, the total SKU count for the
  // header, and the distinct categories for the filter dropdown. All are direct
  // server-side Prisma queries, safe in a Server Component.
  const [rows, total, categories] = await Promise.all([
    prisma.product.findMany({ orderBy: { sku: "asc" } }),
    prisma.product.count(),
    prisma.product.findMany({
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    }),
  ]);

  const products: Product[] = rows
    .filter((p) => {
      // Server-side filter: match on name or SKU, then narrow by category.
      const matchesTerm =
        term === "" ||
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term);
      const matchesCategory =
        activeCategory === "all" || p.category === activeCategory;
      return matchesTerm && matchesCategory;
    })
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      retail: formatPrice(p.price),
      cost: formatPrice(p.cost),
      stock: p.stock,
      rawPrice: p.price,
      rawCost: p.cost,
    }))
    // Server-side column sort: ?sort=price orders by retail price, ?sort=stock
    // by stock level. Direction toggles with ?order=desc (default asc). We sort
    // on the raw numeric fields (rawPrice / stock) so "Retail Price" orders by
    // value, not by the formatted "$..." string. When no sort is requested the
    // rows keep the default SKU ordering from Prisma.
    .sort((a, b) => {
      if (!sortField) return 0;
      const dir = sortOrder === "asc" ? 1 : -1;
      const av = sortField === "price" ? a.rawPrice : a.stock;
      const bv = sortField === "price" ? b.rawPrice : b.stock;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Inventory Management
          </h1>
          <p className="text-sm text-zinc-500">
            Showing{" "}
            <span className="font-medium text-zinc-900">{products.length.toLocaleString()}</span>
            {" "}of{" "}
            <span className="font-medium text-zinc-900">{total.toLocaleString()}</span>{" "}
            SKU items
          </p>
        </div>
      </header>

      {/* Controls row — a GET form so submitting (Enter or changing the
          dropdown) updates the URL searchParams, which re-renders this Server
          Component with the filtered rows. CategoryFilter is a small client
          island so the dropdown can submit the form on change. */}
      <form className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3-3" />
          </svg>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search items..."
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
          />
        </div>

        <CategoryFilter
          categories={categories.map((c) => c.category)}
          active={activeCategory}
        />

        {/* "Add New Product" trigger + modal. Client island (manages open
            state); submits to the createProduct Server Action, which inserts
            via Prisma and revalidates this page so the new row streams in. */}
        <AddProductDialog />
      </form>

      {/* Data table */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-3 font-medium">SKU / Barcode</th>
                <th className="px-5 py-3 font-medium">Product Name</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">
                  <SortColumnHeader
                    field="price"
                    label="Retail Price"
                    activeField={sortField}
                    order={sortOrder}
                    baseQuery={{ q: query, category: activeCategory }}
                  />
                </th>
                <th className="px-5 py-3 font-medium">Cost Price</th>
                <th className="px-5 py-3 font-medium">
                  <SortColumnHeader
                    field="stock"
                    label="Stock Level"
                    activeField={sortField}
                    order={sortOrder}
                    baseQuery={{ q: query, category: activeCategory }}
                  />
                </th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {products.map((p) => (
                <tr key={p.sku} className="hover:bg-zinc-50">
                  <td className="px-5 py-3 font-mono text-xs font-medium text-zinc-700">
                    {p.sku}
                  </td>
                  <td className="px-5 py-3 font-medium text-zinc-900">{p.name}</td>
                  <td className="px-5 py-3 text-zinc-600">{p.category}</td>
                  <td className="px-5 py-3 text-zinc-900">{p.retail}</td>
                  <td className="px-5 py-3 text-zinc-500">{p.cost}</td>
                  <td className="px-5 py-3">
                    <StockBadge stock={p.stock} />
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill stock={p.stock} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <EditProductDialog
                        product={{
                          id: p.id,
                          name: p.name,
                          sku: p.sku,
                          category: p.category,
                          price: String(p.rawPrice),
                          cost: String(p.rawCost),
                          stock: String(p.stock),
                        }}
                      />
                      <DeleteProductButton id={p.id} name={p.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Stock count pill: red for low (<10), brighter red for out (0), neutral otherwise. */
function StockBadge({ stock }: { stock: number }) {
  const color =
    stock === 0
      ? "bg-red-100 text-red-800"
      : stock < 10
        ? "bg-red-50 text-red-700"
        : "bg-zinc-100 text-zinc-700";
  const label = stock === 0 ? "0 in stock" : `${stock} in stock`;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

/** Human-readable status derived from stock level. */
function StatusPill({ stock }: { stock: number }) {
  const status =
    stock === 0 ? "Out of Stock" : stock < 10 ? "Low Stock" : "In Stock";
  const color =
    stock === 0
      ? "bg-red-100 text-red-800"
      : stock < 10
        ? "bg-red-50 text-red-700"
        : "bg-emerald-50 text-emerald-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

/**
 * A sortable column header rendered as a relative-positioned anchor. Clicking
 * sets ?sort=<field> in the URL and toggles ?order= asc↔desc on the active
 * column (or starts fresh at asc when switching columns). It preserves the
 * existing text search (q) and category filters by carrying them through in the
 * query string, so sorting never clobbers an active filter. Because the whole
 * page is a Server Component, clicking just navigates and re-renders server-side.
 */
function SortColumnHeader({
  field,
  label,
  activeField,
  order,
  baseQuery,
}: {
  field: SortField;
  label: string;
  activeField: SortField | undefined;
  order: Order;
  baseQuery: { q: string; category: string };
}) {
  const isActive = activeField === field;
  const nextOrder: Order = isActive && order === "asc" ? "desc" : "asc";

  const params = new URLSearchParams();
  if (baseQuery.q) params.set("q", baseQuery.q);
  if (baseQuery.category && baseQuery.category !== "all") {
    params.set("category", baseQuery.category);
  }
  params.set("sort", field);
  if (nextOrder === "desc") params.set("order", "desc");
  const href = `?${params.toString()}`;

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-zinc-500 transition-colors hover:text-zinc-900"
      aria-sort={isActive ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      {isActive && (
        <svg
          className="h-3 w-3 text-zinc-900"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {order === "asc" ? (
            <path d="M6 3 2.5 7.5h7z" />
          ) : (
            <path d="M6 9 2.5 4.5h7z" />
          )}
        </svg>
      )}
    </Link>
  );
}
