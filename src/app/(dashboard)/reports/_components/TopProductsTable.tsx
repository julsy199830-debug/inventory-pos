import type { FormatSettings } from '@/lib/format'
import type { AnalyticsTopProduct } from "../actions";
import { formatMoney } from "./chart-theme";
import { Panel } from "@/app/_components/ui/Panel";
import { TableHead } from "@/app/_components/ui/PageHeader";

/**
 * Top-selling products table — best movers by units sold over the last 30
 * days. A pure presentational Server Component (no state, no recharts), so it
 * renders with zero client JavaScript.
 *
 * Thumbnail column: the Product model has no image column today, so each row
 * falls back to an blue-gradient initials avatar. `imageUrl` is typed on the
 * action payload anyway; the moment a product carries one, the avatar swaps
 * to the photo (CSS background-image, no `<img>` to configure or lint).
 */
export default function TopProductsTable({
  products,
  format,
}: {
  products: AnalyticsTopProduct[];
  format?: FormatSettings;
}) {
  return (
    <Panel
      title="Top Selling Products"
      subtitle="Best movers by units sold — last 30 days."
      className="overflow-hidden"
      bodyClassName="p-0"
      empty={products.length === 0}
      emptyTitle="No product sales in the last 30 days."
      emptyBody="Completed sales in this window will rank products here."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <TableHead>
            <th className="px-5 py-3 font-medium">Rank</th>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 text-right font-medium">Units Sold</th>
                <th className="px-5 py-3 text-right font-medium">Revenue</th>
          </TableHead>
            <tbody className="divide-y divide-slate-200">
              {products.map((product, i) => (
                <tr key={product.productId} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
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
                              <span className="text-slate-600"> · </span>
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
                  <td className="px-5 py-3 text-right font-semibold text-indigo-700">
                    {formatMoney(product.revenue, format)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </Panel>
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
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-semibold text-white"
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
