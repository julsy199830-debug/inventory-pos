import { prisma } from "@/lib/db";

/**
 * Per-product profitability row in the breakdown table.
 */
export interface ProductBreakdownRow {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  cogs: number;
  profit: number;
  margin: number;
}

/**
 * Top-level financial summary for a date range: headline KPIs plus a
 * profitability breakdown per product. Computed from completed sales whose
 * `createdAt` falls inside the (inclusive-of-both-endpoints) range.
 */
export interface FinancialSummary {
  revenue: number;
  cogs: number;
  tax: number;
  profit: number;
  margin: number;
  productBreakdown: ProductBreakdownRow[];
}

/**
 * Resolve the financial summary for the given date range.
 *
 * Revenue and COGS are aggregated from line items (revenue = priceAtSale *
 * quantity, COGS = product.cost * quantity); tax is summed from the parent sale.
 * SQLite returns sum() over numeric columns as numbers here (priceAtSale,
 * cost, tax are all Float), so we coerce defensively with Number().
 */
export async function getFinancialSummary({
  startDate,
  endDate,
}: {
  startDate: Date;
  endDate: Date;
}): Promise<FinancialSummary> {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  // Aggregate totals across all sale items joined to completed sales in range.
  const totals = await prisma.saleItem.aggregate({
    _sum: {
      quantity: true,
    },
    where: {
      sale: {
        status: "Completed",
        createdAt: { gte: start, lte: end },
      },
    },
  });

  // Prisma's aggregate only lets us sum SaleItem columns, not cross-table
  // expressions like cost*quantity, so fetch the joined rows and fold them in
  // JS. The SaleItem set for a range is small enough that a single query with
  // includes is materially simpler than raw SQL and avoids drift with the
  // schema. The parent sale's tax is a per-sale quantity, so we sum it
  // separately over sales in range (avoids multiplying tax across line items).
  const [lineItems, saleTaxAgg] = await Promise.all([
    prisma.saleItem.findMany({
      where: {
        sale: {
          status: "Completed",
          createdAt: { gte: start, lte: end },
        },
      },
      include: { product: { select: { id: true, name: true, cost: true } } },
    }),
    prisma.sale.aggregate({
      _sum: { tax: true },
      where: {
        status: "Completed",
        createdAt: { gte: start, lte: end },
      },
    }),
  ]);

  void totals; // quantity total kept available for future use; not part of KPIs today.

  let revenue = 0;
  let cogs = 0;
  const perProduct = new Map<
    string,
    {
      productName: string;
      quantitySold: number;
      revenue: number;
      cogs: number;
    }
  >();

  for (const line of lineItems) {
    const quantity = line.quantity;
    const lineRevenue = line.priceAtSale * quantity;
    const unitCost = line.product?.cost ?? 0;
    const lineCogs = unitCost * quantity;

    revenue += lineRevenue;
    cogs += lineCogs;

    const existing = perProduct.get(line.productId);
    if (existing) {
      existing.quantitySold += quantity;
      existing.revenue += lineRevenue;
      existing.cogs += lineCogs;
    } else {
      perProduct.set(line.productId, {
        productName: line.product?.name ?? "Unknown product",
        quantitySold: quantity,
        revenue: lineRevenue,
        cogs: lineCogs,
      });
    }
  }

  const tax = Number(saleTaxAgg._sum.tax ?? 0);
  const profit = revenue - cogs;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  const productBreakdown: ProductBreakdownRow[] = Array.from(
    perProduct.entries()
  ).map(([productId, p]) => {
    const rowProfit = p.revenue - p.cogs;
    return {
      productId,
      productName: p.productName,
      quantitySold: p.quantitySold,
      revenue: p.revenue,
      cogs: p.cogs,
      profit: rowProfit,
      margin: p.revenue > 0 ? (rowProfit / p.revenue) * 100 : 0,
    };
  });

  productBreakdown.sort((a, b) => b.profit - a.profit);

  return { revenue, cogs, tax, profit, margin, productBreakdown };
}
