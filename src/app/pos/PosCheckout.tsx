'use client'

import { useMemo, useState } from 'react'
import { createSale, type CreateSaleResult } from '@/app/actions/sales'

/**
 * Public props passed up from `page.tsx` so this Client Component never touches
 * the Prisma client directly. The server pre-selects only the fields the UI
 * needs — no `cost`, `supplierId`, timestamps, or customer contact details leak
 * into the bundle.
 */
export type PosProduct = {
  id: string
  name: string
  price: number
  stock: number
  category: string
}

export type PosCustomer = {
  id: string
  name: string
  loyaltyPoints: number
}

type CartLine = {
  product: PosProduct
  qty: number
}

const TAX_RATE = 0.08

type Feedback =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; message: string }

export default function PosCheckout({
  products,
  customers,
}: {
  products: PosProduct[]
  customers: PosCustomer[]
}) {
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState<string>('')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' })

  // Group products by category for the catalog grid; stable order matches the
  // server's `orderBy name`.
  const categories = useMemo(() => {
    const seen = new Map<string, PosProduct[]>()
    for (const p of products) {
      const bucket = seen.get(p.category) ?? []
      bucket.push(p)
      seen.set(p.category, bucket)
    }
    return Array.from(seen.entries())
  }, [products])

  const addToCart = (product: PosProduct) =>
    setCart((prev) => {
      const existing = prev.find((line) => line.product.id === product.id)
      if (existing) {
        return prev.map((line) =>
          line.product.id === product.id ? { ...line, qty: line.qty + 1 } : line,
        )
      }
      return [...prev, { product, qty: 1 }]
    })

  const changeQty = (id: string, delta: number) =>
    setCart((prev) =>
      prev
        .map((line) =>
          line.product.id === id ? { ...line, qty: line.qty + delta } : line,
        )
        // Drop a line entirely once it falls to zero or below.
        .filter((line) => line.qty > 0),
    )

  const subtotal = cart.reduce(
    (sum, line) => sum + line.product.price * line.qty,
    0,
  )
  const tax = subtotal * TAX_RATE
  const total = subtotal + tax

  async function onCheckout() {
    // Standard React state only — no try/catch swallowing, no DOM poking. The
    // action resolves with a discriminated `{ ok, ... }`, which is the only
    // thing we branch on. A thrown exception (network/transport) is allowed to
    // surface the framework's nearest error boundary rather than be hidden.
    setPending(true)
    setFeedback({ kind: 'idle' })

    const res: CreateSaleResult = await createSale({
      customerId: customerId || null,
      subtotal,
      tax,
      totalAmount: total,
      paymentMethod: 'Card',
      items: cart.map((line) => ({
        productId: line.product.id,
        quantity: line.qty,
        priceAtSale: line.product.price,
      })),
    })

    setPending(false)
    if (res.ok) {
      setFeedback({
        kind: 'success',
        message: `Sale ${res.data.id.slice(0, 8)} complete.`,
      })
      setCart([])
      setCustomerId('')
    } else {
      setFeedback({ kind: 'error', message: res.error })
    }
  }

  return (
    <div className="flex h-screen w-full flex-col bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-zinc-900">Point of Sale</h1>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Register #1 — Online
        </span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Product catalog */}
        <section className="flex flex-1 flex-col overflow-hidden border-r border-zinc-200">
          <div className="overflow-y-auto p-6">
            {categories.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">
                No products stocked yet.
              </p>
            ) : (
              categories.map(([category, items]) => (
                <div key={category} className="mb-6">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {category}
                  </h2>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                    {items.map((p) => {
                      const out = p.stock <= 0
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={out}
                          onClick={() => addToCart(p)}
                          className="rounded-xl border border-zinc-200 bg-white p-4 text-left transition enabled:hover:border-zinc-900 enabled:hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <p className="text-sm font-semibold text-zinc-900">
                            {p.name}
                          </p>
                          <p className="mt-1 text-sm font-medium text-zinc-500">
                            ${p.price.toFixed(2)}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-400">
                            {out ? 'Out of stock' : `${p.stock} in stock`}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Checkout cart */}
        <aside className="flex w-[400px] shrink-0 flex-col bg-white">
          <div className="border-b border-zinc-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-zinc-900">Current Order</h2>
          </div>

          {/* Optional customer link for loyalty accrual. Empty option = guest. */}
          <div className="border-b border-zinc-200 px-6 py-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Customer
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            >
              <option value="">Guest (no loyalty)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.loyaltyPoints} pts
                </option>
              ))}
            </select>
          </div>

          {/* Feedback banner — success or error, plain conditional render. */}
          {feedback.kind === 'error' && (
            <p className="mx-6 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {feedback.message}
            </p>
          )}
          {feedback.kind === 'success' && (
            <p className="mx-6 mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {feedback.message}
            </p>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {cart.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-400">
                No items yet. Tap a product to add it.
              </p>
            ) : (
              <ul className="space-y-3">
                {cart.map((line) => (
                  <li key={line.product.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">
                        {line.product.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        ${line.product.price.toFixed(2)} each
                      </p>
                    </div>
                    <div className="inline-flex items-center rounded-lg border border-zinc-200">
                      <button
                        type="button"
                        onClick={() => changeQty(line.product.id, -1)}
                        className="px-2.5 py-1 text-sm text-zinc-500 hover:bg-zinc-50"
                      >
                        −
                      </button>
                      <span className="px-2.5 py-1 text-sm font-medium text-zinc-900">
                        {line.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeQty(line.product.id, 1)}
                        className="px-2.5 py-1 text-sm text-zinc-500 hover:bg-zinc-50"
                      >
                        +
                      </button>
                    </div>
                    <span className="w-16 text-right text-sm font-semibold text-zinc-900">
                      ${(line.product.price * line.qty).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-zinc-200 px-6 py-4">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-500">
                <dt>Subtotal</dt>
                <dd>${subtotal.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between text-zinc-500">
                <dt>Tax (8%)</dt>
                <dd>${tax.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between border-t border-zinc-100 pt-1.5 text-base font-semibold text-zinc-900">
                <dt>Grand Total</dt>
                <dd>${total.toFixed(2)}</dd>
              </div>
            </dl>

            <button
              type="button"
              disabled={cart.length === 0 || pending}
              onClick={onCheckout}
              className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none"
            >
              {pending ? 'Processing…' : 'Process Payment'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
