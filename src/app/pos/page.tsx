import { prisma } from '@/lib/db'
import { requirePageAuth } from '@/lib/session'
import PosCheckout, { type PosStore } from './PosCheckout'

export default async function POSPage() {
  const user = await requirePageAuth()

  const [productRows, customers, settings] = await Promise.all([
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
        loyaltyPoints: true,
        creditLimit: true,
        currentBalance: true,
      },
    }),
    prisma.storeSetting.findFirst(),
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



  const store: PosStore = {
    storeName: settings?.storeName ?? 'InvPos Store',
    address: settings?.address ?? null,
    phone: settings?.phone ?? null,
    currencySymbol: settings?.currencySymbol ?? '₱',
    taxRate: settings?.taxRate ?? 0,
  }



  return (
    <PosCheckout
      cashier={{ id: user.id, name: user.name, role: user.role }}
      products={products}
      customers={customers}
      store={store}
    />
  )
}
