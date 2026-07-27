import { prisma } from '@/lib/db'
import PosCheckout from './PosCheckout'

/**
 * POS register (/pos).
 *
 * This route is a Server Component: it loads the real product catalog and
 * customer list from the database and hands them to {@link PosCheckout}, the
 * Client Component that owns the cart state and drives checkout by calling the
 * `createSale` Server Action.
 *
 * Keeping the read here (not in the client) matches the rest of the `(dashboard)`
 * pages — the Prisma client never ships to the browser, and the data is fresh on
 * every navigation. The mutation (writing a sale, decrementing stock, accruing
 * loyalty points) happens atomically inside `createSale`'s transaction.
 */
export default async function POSPage() {
  const [products, customers] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, price: true, stock: true, category: true },
    }),
    prisma.customer.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, loyaltyPoints: true },
    }),
  ])

  return <PosCheckout products={products} customers={customers} />
}
