import { getFormatSettings } from "@/lib/store-config";
import { formatMoney, type FormatSettings } from "@/lib/format";
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
import StockStatusFilter from "./StockStatusFilter";
import StockControls from "./StockControls";
import StockCountDialog from "./StockCountDialog";
import StockHistoryDialog from "./StockHistoryDialog";
import ExportCsvButton from "./ExportCsvButton";
import ProductImportDialog from "./ProductImportDialog";
import ProductThumb from "@/app/_components/ui/ProductThumb";
import { Panel } from "@/app/_components/ui/Panel";
import { ShareBars } from "@/app/_components/ui/ShareBars";
import { StatCard } from "@/app/_components/ui/StatCard";
import { categoryInsights, inventoryValuation } from "@/lib/analytics";

/** Sorting direction, ascending or descending. */
type Order = "asc" | "desc";

/** Allowable sort columns, keyed by the URL value. Sort is only ever applied to
 * Retail Price (price) and Stock Level (stock); any other ?sort= token falls
 * back to the default SKU ascending ordering. */
type SortField = "price" | "stock" | "value" | "name";
const SORT_FIELDS: Record<string, SortField> = {
  price: "price",
  stock: "stock",
  value: "value",
  name: "name",
};
const DEFAULT_ORDER: Order = "asc";

/**
 * The display name for a category id, for the empty-state summary.
 *
 * The URL carries an id, not a name, so the message has to resolve it. Falls
 * back to the raw id rather than rendering "undefined": a category deleted
 * after a filter was bookmarked is exactly the case where the user needs to be
 * told what they were looking at.
 */
function categoryNameFor(
  id: string,
  categories: { id: string; name: string }[],
): string {
  return categories.find((c) => c.id === id)?.name ?? id;
}

/** Stock-state filter. `all` keeps every row; `low` and `out` are the two states
 * a storekeeper actually triages. Both are derived from the product's CATEGORY
 * threshold, not the blanket default, so the filter can never disagree with the
 * status badge rendered on the same row. */
type StatusFilter = "all" | "low" | "out";
const STATUS_FILTERS: Record<string, StatusFilter> = {
  all: "all",
  low: "low",
  out: "out",
};

/**
 * The comparable value for a numeric sort column, on a mapped product row.
 *
 * `value` is the retail value of the line (`stock * price`) rather than a
 * stored column: it is the figure a storekeeper means by "biggest" when
 * deciding what to reorder, and deriving it here rather than in SQL guarantees
 * it can never disagree with the Stock Value column on the same row.
 */
function sortValue(product: Product, field: SortField): number {
  switch (field) {
    case "price":
      return product.rawPrice;
    case "stock":
      return product.stock;
    case "value":
      return product.stock * product.rawPrice;
    default:
      return 0;
  }
}

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
  /** Stored product photo reference, or null when the product has none. Drives
   * the row thumbnail; `ProductThumb` renders an initials tile for null. */
  imageUrl: string | null;
};

/** Format a number as Philippine Peso currency, e.g. 199 -> "₱199.00". */
function formatPrice(value: number, format: FormatSettings): string {
  return formatMoney(value, format);
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
  const { q = "", category = "all", status = "all", sort, order } = await searchParams;
  const query = Array.isArray(q) ? q[0] ?? "" : q;
  const rawStatus = Array.isArray(status) ? status[0] ?? "all" : status;
  // An unrecognised ?status= token falls back to "all" rather than showing an
  // empty table, so a stale bookmark degrades to the full catalog.
  const statusFilter: StatusFilter = STATUS_FILTERS[rawStatus] ?? "all";
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
  const format = await getFormatSettings();

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
        p.sku.toLowerCase().includes(term) ||
        (p.category?.name ?? "").toLowerCase().includes(term);
      const matchesCategory =
        activeCategory === "all" || p.categoryId === activeCategory;
      // The status filter uses the SAME category-aware threshold the badge on
      // this row uses, so a filtered list can never contradict the row it shows.
      // `out` is exactly zero; `low` is below the cutoff but still sellable.
      const status = stockStatusAt(p.stock, p.category?.lowStockThreshold);
      const matchesStatus = statusFilter === "all" || status === statusFilter;

      return matchesTerm && matchesCategory && matchesStatus;
    })
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      categoryName: p.category?.name ?? null,
      categoryId: p.categoryId,
      retail: formatPrice(p.price, format),
      cost: formatPrice(p.cost, format),
      stock: p.stock,
      rawPrice: p.price,
      rawCost: p.cost,
      imageUrl: p.imageUrl,
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
      // Text columns compare case-insensitively and fall back to SKU, so equal
      // names still produce one stable order rather than reshuffling per render.
      if (sortField === "name") {
        const cmp = a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
        });
        return cmp !== 0 ? cmp * dir : a.sku.localeCompare(b.sku);
      }
      const av = sortValue(a, sortField);
      const bv = sortValue(b, sortField);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.sku.localeCompare(b.sku);
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

  // ── Phase 2 derived figures ────────────────────────────────────────────────
  //
  // Computed from `rows`, the UNFILTERED catalog, so the status tabs keep
  // showing the real size of the restock queue. Deriving them from the
  // already-filtered list would make the counts collapse to whatever the
  // current filter allows, which defeats the point: the tabs exist to tell you
  // how much is waiting on the other side.
  const catalogForStats = rows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    stock: p.stock,
    price: p.price,
    cost: p.cost,
    category: p.category,
  }));

  const statusCounts: Record<StatusFilter, number> = {
    all: rows.length,
    low: 0,
    out: 0,
  };
  for (const p of rows) {
    const status = stockStatusAt(p.stock, p.category?.lowStockThreshold);
    if (status === "out") statusCounts.out += 1;
    else if (status === "low") statusCounts.low += 1;
  }

  // Valuation answers for the WHOLE catalog, not the filtered page. A
  // storekeeper asking "what is my stock worth" is asking about the shop, and a
  // figure that silently changed meaning when they typed in the search box
  // would be worse than showing no figure at all.
  const valuation = inventoryValuation(catalogForStats);
  const categoryBreakdown = categoryInsights(catalogForStats).slice(0, 6);

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
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
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
            className="w-full rounded-xl border border-slate-300 bg-white shadow-sm py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
        </div>

        <CategoryFilter categories={categoryOptions} active={activeCategory} />

        {/* Phase 2: stock-state tabs, carrying the text search and category
            through so the filters compose rather than replacing one another. */}
        <StockStatusFilter
          active={statusFilter}
          counts={statusCounts}
          baseQuery={{ q: query, category: activeCategory, status: statusFilter }}
        />

        {/* Phase 2: what the shelf is worth. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Retail value"
            value={formatPrice(valuation.retailValue, format)}
            hint={`${valuation.units.toLocaleString("en-US")} units across ${valuation.skus} SKUs`}
          />
          <StatCard
            label="Cost value"
            value={formatPrice(valuation.costValue, format)}
            hint="what the stock is on hand for"
          />
          <StatCard
            label="Gross margin"
            value={`${valuation.marginPercent.toFixed(1)}%`}
            hint={`${formatPrice(valuation.marginValue, format)} on the shelf`}
          />
          <StatCard
            label="Value at risk"
            value={formatPrice(valuation.atRiskValue, format)}
            hint="retail value sitting on low lines"
            tone={valuation.atRiskValue > 0 ? "warning" : "default"}
          />
        </div>

        {/* "Add New Product" trigger + modal. Client island (manages open
            state); submits to the createProduct Server Action, which inserts
            via Prisma and revalidates this page so the new row streams in.
            `categories` populates the managed-category <select> inside. */}
        <AddProductDialog categories={categoryOptions} />

        {/* Physical stock count. Prefers the *unfiltered* catalog so a full
            count sheet is never silently short because a search box or category
            chip happened to be active — a count is a whole-store task, and a
            partial sheet that looks complete is worse than no sheet. */}
        <StockCountDialog
          products={rows.map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            imageUrl: p.imageUrl,
            stock: p.stock,
          }))}
        />

        {/* Export CSV — serializes the rows currently rendered (respecting
            the active search/category filters) for spreadsheets. Client
            island; builds the file locally, no server round-trip. */}
        <ExportCsvButton
          rows={products.map((p) => ({
            sku: p.sku,
            name: p.name,
            categoryName: p.categoryName,
            price: p.rawPrice,
            cost: p.rawCost,
            stock: p.stock,
            threshold: p.threshold,
          }))}
        />

        {/* Phase 1e: the round-trippable bulk import. Sits beside the export
            above it deliberately — export the catalog, edit in a spreadsheet,
            re-import. */}
        <ProductImportDialog />

        {/* Manage categories link — the `/inventory/categories` page governs
            the set of categories (rename, threshold, delete) that this form
            and filter draw from. Plain server <Link>, so it stays a Server
            Component with no client island. */}
        <Link
          href="/inventory/categories"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white shadow-sm px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
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

      {/* Phase 2: per-category rollup, so "where is my money sitting" and
          "what is running out" are answerable without exporting anything. */}
      <Panel
        title="Category insights"
        subtitle="Units, value and stock health per category"
        action={
          <Link
            href="/inventory/categories"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            Manage
          </Link>
        }
      >
        <ShareBars
          tone="indigo"
          rows={categoryBreakdown.map((row) => ({
            label: row.name,
            detail: categoryDetail(row),
            value: formatPrice(row.retailValue, format),
            share: row.unitShare,
          }))}
        />
      </Panel>

      {/* Data table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                <th className="w-14 px-4 py-3">
                  <span className="sr-only">Image</span>
                </th>
                <th className="px-4 py-3 font-medium">SKU / Barcode</th>
                {/* Phase 2: the name is sortable too. In a long catalog
                    alphabetical is the fastest way to find a line, and it was
                    previously unreachable without a client-side resort. */}
                <th className="px-4 py-3 font-medium">
                  <SortColumnHeader
                    field="name"
                    label="Product Name"
                    activeField={sortField}
                    order={sortOrder}
                    baseQuery={{ q: query, category: activeCategory, status: statusFilter }}
                  />
                </th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">
                  <SortColumnHeader
                    field="price"
                    label="Retail Price"
                    activeField={sortField}
                    order={sortOrder}
                    baseQuery={{ q: query, category: activeCategory, status: statusFilter }}
                  />
                </th>
                <th className="px-4 py-3 font-medium">Cost Price</th>
                {/* Phase 2: the retail value of the line on hand. This is the
                    number that decides reorder priority, and it is sortable
                    because "biggest by value" is the usual restocking question. */}
                <th className="px-4 py-3 font-medium">
                  <SortColumnHeader
                    field="value"
                    label="Stock Value"
                    activeField={sortField}
                    order={sortOrder}
                    baseQuery={{ q: query, category: activeCategory, status: statusFilter }}
                  />
                </th>
                <th className="px-4 py-3 font-medium">
                  <SortColumnHeader
                    field="stock"
                    label="Stock Level"
                    activeField={sortField}
                    order={sortOrder}
                    baseQuery={{ q: query, category: activeCategory, status: statusFilter }}
                  />
                </th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {/* Phase 2 empty state. Previously a filter that matched nothing
                  rendered a bare header over an empty body, which reads as a
                  broken page rather than as "nothing matches". This says which
                  filters are active and gives a way back out. */}
              {products.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-14 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      No products match these filters
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
                      {[
                        query.trim() ? `search "${query.trim()}"` : null,
                        activeCategory !== "all"
                          ? `category "${categoryNameFor(activeCategory, categoryOptions)}"`
                          : null,
                        statusFilter !== "all"
                          ? `stock ${statusFilter === "out" ? "out of stock" : "low"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <Link
                      href="/inventory"
                      className="mt-4 inline-block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Clear all filters
                    </Link>
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                <tr key={p.sku} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <ProductThumb
                      imageUrl={p.imageUrl}
                      name={p.name}
                      size="sm"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700">
                    {p.sku}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.categoryName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{p.retail}</td>
                  <td className="px-4 py-3 text-slate-500">{p.cost}</td>
                  {/* Phase 2: the same `stock * price` the "Stock Value" sort
                      uses, so the column a storekeeper reads always agrees with
                      the order they clicked. */}
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {formatPrice(p.stock * p.rawPrice, format)}
                  </td>
                  <td className="px-4 py-3">
                    <StockBadge stock={p.stock} threshold={p.threshold} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill stock={p.stock} threshold={p.threshold} />
                  </td>
                  <td className="px-4 py-3 text-right">
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
                          imageUrl: p.imageUrl,
                        }}
                        categories={categoryOptions}
                      />
                      <DeleteProductButton id={p.id} name={p.name} />
                    </div>
                  </td>
                </tr>
              ))
              )}
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
  out: {
    badge: "bg-red-50 text-red-700 ring-1 ring-red-200",
    status: "Out of Stock",
  },
  low: {
    badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    status: "Low Stock",
  },
  ok: {
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    status: "In Stock",
  },
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
      ? "bg-red-50 text-red-700 ring-1 ring-red-200"
      : status === "low"
        ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
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
 * The subtitle under a category row: how many SKUs, and whether any of them
 * need attention.
 *
 * The "all healthy" branch matters as much as the warning one. Without it the
 * panel would be silent about the categories that are fine, and a storekeeper
 * would have to open each one to confirm there was nothing to do.
 */
function categoryDetail(row: {
  skus: number;
  lowStock: number;
  outOfStock: number;
}): string {
  const skus = `${row.skus} SKU${row.skus === 1 ? "" : "s"}`;
  const needs = row.lowStock + row.outOfStock;
  if (needs === 0) return `${skus} - all healthy`;
  const parts: string[] = [];
  if (row.outOfStock > 0) parts.push(`${row.outOfStock} out of stock`);
  if (row.lowStock > 0) parts.push(`${row.lowStock} low`);
  return `${skus} - ${parts.join(", ")}`;
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
  baseQuery: { q: string; category: string; status: string };
}) {
  const isActive = activeField === field;
  const nextOrder: Order = isActive && order === "asc" ? "desc" : "asc";

  const params = new URLSearchParams();
  if (baseQuery.q) params.set("q", baseQuery.q);
  if (baseQuery.category && baseQuery.category !== "all") {
    params.set("category", baseQuery.category);
  }
  // Phase 2: sorting must preserve the stock-state filter too. Losing it on a
  // sort click would silently widen a low-stock list back to the whole catalog,
  // which looks like the filter broke rather than like a navigation.
  if (baseQuery.status && baseQuery.status !== "all") {
    params.set("status", baseQuery.status);
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
