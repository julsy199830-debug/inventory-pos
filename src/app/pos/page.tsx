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
        category: { select: { name: true } },
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
    category: p.category?.name ?? 'Uncategorized',
  }))



  const store: PosStore = {
    storeName: settings?.storeName ?? 'My Store',
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
