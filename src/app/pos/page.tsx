import { prisma } from '@/lib/db'
import { requirePageAuth } from '@/lib/session'
import { getFormatSettings } from '@/lib/store-config'
import PosCheckout, { type PosStore } from './PosCheckout'

export default async function POSPage() {
  const user = await requirePageAuth()

  const [productRows, customers, settings, format] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        stock: true,
        imageUrl: true,
        category: { select: { name: true, lowStockThreshold: true } },
      },
    }),
    prisma.customer.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        // Phase 4: the POS picker searches by phone as well as name, and shows
        // a compact "last seen" so a cashier can tell a regular from a
        // one-off. Both are display fields read straight off the row - no
        // loyalty or credit figure is recalculated here.
        phone: true,
        loyaltyPoints: true,
        creditLimit: true,
        currentBalance: true,
        _count: { select: { sales: true } },
        sales: {
          // Newest first; only the head of each customer's list is used, so
          // ordering + take:1 keeps this one indexed query rather than a
          // per-customer lookup.
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    prisma.storeSetting.findFirst(),
    getFormatSettings(),
  ])

  const products = productRows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    stock: p.stock,
    imageUrl: p.imageUrl,
    category: p.category?.name ?? 'Uncategorized',
    // Phase 3: the register shows stock health, so it needs the SAME cutoff
    // every other screen uses. Passing the category's own threshold keeps the
    // POS card, the inventory badge and the restock list in agreement - the POS
    // used to hardcode a private "low means <= 5", which disagreed with a
    // category configured to restock at 20 or 50. `null` means "no override",
    // and `lowStockThresholdFor` resolves it to the app-wide default.
    lowStockThreshold: p.category?.lowStockThreshold ?? null,
  }))



  // Flatten the nested `sales` head into plain display fields, so the client
  // component stays a dumb renderer and cannot accidentally reach for a nested
  // shape that invites recalculating a balance somewhere downstream.
  const posCustomers = customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    loyaltyPoints: c.loyaltyPoints,
    creditLimit: c.creditLimit,
    currentBalance: c.currentBalance,
    salesCount: c._count.sales,
    lastSaleAt: c.sales[0]?.createdAt.toISOString() ?? null,
  }))

  const store: PosStore = {
    storeName: settings?.storeName ?? 'InvPos Store',
    address: settings?.address ?? null,
    phone: settings?.phone ?? null,
    // Phase 6: the whole resolved settings object travels to the register so
    // checkout, the receipt and the history panel all render money through the
    // ONE shared formatter. Previously the register, the receipt and the history
    // each had a private formatter and three of them disagreed about grouping.
    format,
    currencySymbol: settings?.currencySymbol ?? '₱',
    taxRate: settings?.taxRate ?? 0,
  }



  return (
    <PosCheckout
      cashier={{ id: user.id, name: user.name, role: user.role }}
      products={products}
      customers={posCustomers}
      store={store}
    />
  )
}
