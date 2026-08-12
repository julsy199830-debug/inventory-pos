import type { AnalyticsTopProduct } from "../actions";
import { formatMoney } from "./chart-theme";

/**
 * Top-selling products table — best movers by units sold over the last 30
 * days. A pure presentational Server Component (no state, no recharts), so it
 * renders with zero client JavaScript.
 *
 * Thumbnail column: the Product model has no image column today, so each row
 * falls back to an emerald-gradient initials avatar. `imageUrl` is typed on the
 * action payload anyway; the moment a product carries one, the avatar swaps
 * to the photo (CSS background-image, no `<img>` to configure or lint).
 */
export default function TopProductsTable({
  products,
  currencySymbol = "₱",
}: {
  products: AnalyticsTopProduct[];
  currencySymbol?: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          Top Selling Products
        </h2>
        <p className="text-sm text-slate-500">
          Best movers by units sold — last 30 days.
        </p>
      </div>

      {products.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">
          No product sales in the last 30 days.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Rank</th>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 text-right font-medium">Units Sold</th>
                <th className="px-5 py-3 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((product, i) => (
                <tr key={product.productId} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ProductThumb product={product} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {product.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {product.sku}
                          {product.category ? (
                            <>
                              <span className="text-slate-300"> · </span>
                              {product.category}
                            </>
                          ) : null}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-slate-900">
                    {product.unitsSold.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-emerald-700">
                    {formatMoney(product.revenue, currencySymbol)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProductThumb({ product }: { product: AnalyticsTopProduct }) {
  const initials =
    product.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-xs font-semibold text-white"
      style={
        product.imageUrl
          ? {
              backgroundImage: `url(${product.imageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
      aria-label={product.name}
    >
      {!product.imageUrl && initials}
    </span>
  );
}
