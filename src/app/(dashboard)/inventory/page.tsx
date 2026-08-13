import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  LOW_STOCK_THRESHOLD,
  stockStatusAt,
  type StockStatus,
} from "@/lib/types";
import AddProductDialog, {
  type CategoryOption,
} from "./AddProductDialog";
import CategoryFilter from "./CategoryFilter";
import DeleteProductButton from "./DeleteProductButton";
import EditProductDialog from "./EditProductDialog";
import LowStockBanner from "./LowStockBanner";
import StockControls from "./StockControls";
import StockHistoryDialog from "./StockHistoryDialog";

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
  /** Display name of the product's category, or null when uncategorized. The
   * table renders an em-dash for null; the edit dialog binds to `categoryId`. */
  categoryName: string | null;
  /** The product's category id (nullable: uncategorized is a real, legal state
   * since `Product.categoryId` is `SetNull` on category delete). */
  categoryId: string | null;
  retail: string;
  cost: string;
  stock: number;
  /** Raw numeric retail price — used to prefill the edit dialog. */
  rawPrice: number;
  /** Raw numeric cost — used to prefill the edit dialog. */
  rawCost: number;
  /** Effective low-stock threshold — the product's category overrides the
   * app-wide default, else {@link LOW_STOCK_THRESHOLD}. Drives the stock badge
   * + status pill so they reflect the category-tuned cutoff, not a blanket 10. */
  threshold: number;
};

/** Format a number as Philippine Peso currency, e.g. 199 -> "₱199.00". */
function formatPrice(value: number): string {
  return value.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
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
  //
  // `category` is now a category *id* (or the `"all"` sentinel), not the old
  // free-text name — the schema migrated `Product.category` from a string
  // column to a `categoryId` FK, so the filter narrows by id. We resolve it
  // against the actual category set below so a stale URL (a category deleted
  // after it was bookmarked) falls back to `"all"` rather than showing an
  // empty table.
  const { q = "", category = "all", sort, order } = await searchParams;
  const query = Array.isArray(q) ? q[0] ?? "" : q;
  const rawCategory = Array.isArray(category) ? category[0] ?? "all" : category;
  const rawSort = Array.isArray(sort) ? sort[0] : sort;
  const rawOrder = Array.isArray(order) ? order[0] : order;
  const sortField: SortField | undefined = rawSort ? SORT_FIELDS[rawSort] : undefined;
  const sortOrder: Order = rawOrder === "desc" ? "desc" : DEFAULT_ORDER;
  const term = query.trim().toLowerCase();

  // Fetched in parallel: the list of products (with their resolved category),
  // the total SKU count for the header, and the governed categories for the
  // filter dropdown + dialog selects. All are direct server-side Prisma
  // queries, safe in a Server Component.
  const [rows, total, categoryRows] = await Promise.all([
    prisma.product.findMany({
      orderBy: { sku: "asc" },
      include: { category: true },
    }),
    prisma.product.count(),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Category option set shared by the filter, the Add dialog, and the Edit
  // dialog — a single source of truth so all three show the same names/ids and
  // never disagree (e.g. a delete between renders). The empty-string id is the
  // "Uncategorized" sentinel handled in the dialogs.
  const categoryOptions: CategoryOption[] = categoryRows.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  // Validate the URL's category id against the real set: anything that isn't a
  // known id (a typo, or a category deleted since the URL was saved) collapses
  // to `"all"` so the page never renders an empty, confusing table.
  const activeCategory =
    rawCategory !== "all" && categoryOptions.some((c) => c.id === rawCategory)
      ? rawCategory
      : "all";

  const products: Product[] = rows
    .filter((p) => {
      // Server-side filter: match on name or SKU, then narrow by category id.
      const matchesTerm =
        term === "" ||
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term);
      const matchesCategory =
        activeCategory === "all" || p.categoryId === activeCategory;
      return matchesTerm && matchesCategory;
    })
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      categoryName: p.category?.name ?? null,
      categoryId: p.categoryId,
      retail: formatPrice(p.price),
      cost: formatPrice(p.cost),
      stock: p.stock,
      rawPrice: p.price,
      rawCost: p.cost,
      // Effective low-stock cutoff: the category overrides the app-wide default,
      // else LOW_STOCK_THRESHOLD (matches the rule in lib/types.stockStatusAt).
      threshold: p.category?.lowStockThreshold ?? LOW_STOCK_THRESHOLD,
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

  // Products flagged by the low-stock banner: any row whose stock status is
  // "out" or "low" against its effective per-category threshold. The banner is
  // a client island that merely renders these pre-filtered items — no extra
  // Prisma query — and dismisses only for the current client session.
  const lowStockItems = products
    .filter((p) => stockStatusAt(p.stock, p.threshold) !== "ok")
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      stock: p.stock,
      status: stockStatusAt(p.stock, p.threshold),
      threshold: p.threshold,
    }));

  return (
    <div className="space-y-6">
      {/* Low-stock alert banner — surfaces out/low items at the top of the
          page before the controls and table. Client island fed server-side
          data; hidden whenever every product is In Stock. */}
      <LowStockBanner items={lowStockItems} />

      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Inventory Management
          </h1>
          <p className="text-sm text-slate-500">
            Showing{" "}
            <span className="font-medium text-slate-900">{products.length.toLocaleString()}</span>
            {" "}of{" "}
            <span className="font-medium text-slate-900">{total.toLocaleString()}</span>{" "}
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
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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
            className="w-full rounded-xl border border-slate-200/80 bg-white shadow-sm py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/10"
          />
        </div>

        <CategoryFilter categories={categoryOptions} active={activeCategory} />

        {/* "Add New Product" trigger + modal. Client island (manages open
            state); submits to the createProduct Server Action, which inserts
            via Prisma and revalidates this page so the new row streams in.
            `categories` populates the managed-category <select> inside. */}
        <AddProductDialog categories={categoryOptions} />

        {/* Manage categories link — the `/inventory/categories` page governs
            the set of categories (rename, threshold, delete) that this form
            and filter draw from. Plain server <Link>, so it stays a Server
            Component with no client island. */}
        <Link
          href="/inventory/categories"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white shadow-sm px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <svg
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 5.25h16.5M3.75 12h16.5M3.75 18.75h16.5"
            />
          </svg>
          Manage categories
        </Link>
      </form>

      {/* Data table */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
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
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.sku} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs font-medium text-slate-700">
                    {p.sku}
                  </td>
                  <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {p.categoryName ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-900">{p.retail}</td>
                  <td className="px-5 py-3 text-slate-500">{p.cost}</td>
                  <td className="px-5 py-3">
                    <StockBadge stock={p.stock} threshold={p.threshold} />
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill stock={p.stock} threshold={p.threshold} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      {/* Inline +/− quick-adjust: a client island that calls the
                          adjustStock Server Action with the row id and a signed
                          delta. Lives next to the edit/delete controls so a
                          restock or pull is one click, no modal. */}
                      <StockControls id={p.id} stock={p.stock} name={p.name} />
                      <StockHistoryDialog productId={p.id} productName={p.name} />
                      <EditProductDialog
                        product={{
                          id: p.id,
                          name: p.name,
                          sku: p.sku,
                          categoryName: p.categoryName,
                          categoryId: p.categoryId,
                          price: String(p.rawPrice),
                          cost: String(p.rawCost),
                          stock: String(p.stock),
                        }}
                        categories={categoryOptions}
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

// Visual treatment by stock status. The two pill-ish views ({@link StockBadge},
// {@link StatusPill}) share this so a "Low Stock" row is the same shade of red
// whether you're reading the count pill or the status pill, and the per-category
// threshold (not a blanket 10) decides the cutoff — see {@link stockStatusAt}.
const STATUS_STYLES: Record<StockStatus, { badge: string; status: string }> = {
  out: { badge: "bg-red-100 text-red-800", status: "Out of Stock" },
  low: { badge: "bg-red-50 text-red-700", status: "Low Stock" },
  ok: { badge: "bg-blue-50 text-blue-700", status: "In Stock" },
};

/**
 * Stock count pill. The cutoff is the product's effective low-stock threshold
 * (a category override or the app-wide {@link LOW_STOCK_THRESHOLD}), so a
 * high-velocity category with a raised threshold still flags "low" at 50 — not
 * only at the default 10. 0 is always Out of Stock and rendered with a bolder
 * red than merely-low. */
function StockBadge({
  stock,
  threshold,
}: {
  stock: number;
  threshold: number;
}) {
  const status = stockStatusAt(stock, threshold);
  const color =
    status === "out"
      ? "bg-red-100 text-red-800"
      : status === "low"
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-700";
  const label = stock <= 0 ? "0 in stock" : `${stock} in stock`;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

/** Human-readable status derived from stock level + the effective threshold. */
function StatusPill({
  stock,
  threshold,
}: {
  stock: number;
  threshold: number;
}) {
  const status = stockStatusAt(stock, threshold);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status].badge}`}>
      {STATUS_STYLES[status].status}
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
      className="inline-flex items-center gap-1 text-slate-500 transition-colors hover:text-slate-900"
      aria-sort={isActive ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      {isActive && (
        <svg
          className="h-3 w-3 text-slate-900"
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
