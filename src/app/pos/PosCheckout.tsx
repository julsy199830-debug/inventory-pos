'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createSale, type CreateSaleResult } from '@/app/actions/sales'
import { lockRegister } from '@/lib/actions/auth-actions'
import Receipt, { type ReceiptLine } from './Receipt'
import { useBarcodeScanner } from './useBarcodeScanner'
import type { Role } from '@/lib/types'

/**
 * Public props passed up from `page.tsx` so this Client Component never touches
 * the Prisma client directly. The server pre-selects only the fields the UI
 * needs — no `cost`, `supplierId`, timestamps, or customer contact details leak
 * into the bundle.
 */
export type PosProduct = {
  id: string
  name: string
  sku: string
  price: number
  stock: number
  category: string
}

export type PosCustomer = {
  id: string
  name: string
  loyaltyPoints: number
  creditLimit: number
  currentBalance: number
}

/** Store identity for the receipt header — subset of `StoreSetting`. */
export type PosStore = {
  storeName: string
  address: string | null
  phone: string | null
  currencySymbol: string
}

/** Signed-in operator driving the register — passed down from `page.tsx`. */
export type PosCashier = {
  id: string
  name: string
  role: Role
}

type CartLine = {
  product: PosProduct
  qty: number
}

const TAX_RATE = 0.08

type Feedback =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }

/** Snapshot of a completed sale — drives the receipt, captured at checkout. */
type CompletedSale = {
  id: string
  timestamp: string
  lines: ReceiptLine[]
  subtotal: number
  tax: number
  total: number
  paymentMethod: string
}

export default function PosCheckout({
  products,
  customers,
  store,
  cashier,
}: {
  products: PosProduct[]
  customers: PosCustomer[]
  store: PosStore
  cashier: PosCashier
}) {
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' })
  // Dedicated barcode search box value.
  const [scanInput, setScanInput] = useState('')
  // Completed sale awaiting receipt print / dismissal.
  const [completed, setCompleted] = useState<CompletedSale | null>(null)
  // Ref onto the barcode box so a scan-in-empty-area can focus it for the next
  // physical scan (keyboard-emulation scanners type into whatever is focused).
  const scanInputRef = useRef<HTMLInputElement>(null)

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

  const selectedCustomer = customers.find((c) => c.id === customerId)
  const creditBlocked =
    paymentMethod === 'STORE_CREDIT' &&
    (!selectedCustomer ||
      selectedCustomer.currentBalance + total > selectedCustomer.creditLimit)

  // Store-symbol money formatter — the same glyph the Receipt uses, so the cart
  // and the printed slip can never disagree (defaults to ₱ via StoreSetting).
  const money = (value: number) => `${store.currencySymbol}${value.toFixed(2)}`

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
      paymentMethod,
      items: cart.map((line) => ({
        productId: line.product.id,
        quantity: line.qty,
        priceAtSale: line.product.price,
      })),
    })

    setPending(false)
    if (res.ok) {
      // Snapshot the sale BEFORE clearing the cart — the receipt is a pure
      // function of this state, identical to what the register showed.
      setCompleted({
        id: res.data.id,
        timestamp: new Date().toISOString(),
        lines: cart.map((line) => ({
          name: line.product.name,
          qty: line.qty,
          unitPrice: line.product.price,
        })),
        subtotal,
        tax,
        total,
        paymentMethod,
      })
      setFeedback({ kind: 'idle' })
      setCart([])
      setCustomerId('')
      setScanInput('')
    } else {
      setFeedback({ kind: 'error', message: res.error })
    }
  }

  // ── Barcode scanning ─────────────────────────────────────────────────────
  // Products have no `barcode` column in the schema — the scanner matches
  // against `sku` (unique), case-insensitively, so "SKU-123" and "sku-123"
  // resolve to the same product. A successful match adds it (or increments its
  // quantity); an unknown code or an out-of-stock item surfaces as an error.
  const lookUpScannedCode = (code: string) => {
    const key = code.trim().toLowerCase()
    if (key === '') return
    const match = products.find((p) => p.sku.toLowerCase() === key)
    if (match) {
      if (match.stock > 0) {
        addToCart(match)
      } else {
        setFeedback({
          kind: 'error',
          message: `${match.name} is out of stock.`,
        })
      }
    } else {
      setFeedback({
        kind: 'error',
        message: `No product found for "${code.trim()}".`,
      })
    }
  }

  // Global keyboard-emulation scanner: fast key bursts ending in Enter. The
  // hook ignores keystrokes typed into text fields (customer select, barcode
  // box), so a physical scan while a field is focused types into that field
  // instead of the buffer; when nothing is focused it resolves here.
  useBarcodeScanner(lookUpScannedCode)

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          {cashier.role === 'ADMIN' || cashier.role === 'MANAGER' ? (
            <>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200/80/80 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-900">
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Link>
              <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
                <Link
                  href="/"
                  className="font-medium text-slate-500 transition-colors hover:text-blue-600">
                    Dashboard
                  </Link>
                  <span aria-hidden className="text-slate-300">
                    /
                  </span>
                  <span className="font-semibold text-slate-900">Point of Sale</span>
                </nav>
            </>
          ) : (
            // Cashiers have no dashboard access, so swap the navigation for a
            // register title + operator badge instead of a dead link.
            <div className="flex items-center gap-3">
              <span className="text-base font-semibold tracking-tight text-slate-900">
                Apex POS Register
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-blue-100">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {cashier.name} · {cashier.role.charAt(0) + cashier.role.slice(1).toLowerCase()}
              </span>
            </div>
          )}
        </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-blue-100">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Register #1 — Online
            </span>
            <span className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 md:inline-flex">
              {cashier.name}
            </span>
            <button
              type="button"
              onClick={() => lockRegister()}
              className="inline-flex items-center rounded-lg border border-slate-200/80/80 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                Lock
              </button>
            </div>
          </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Product catalog */}
        <section className="flex flex-1 flex-col overflow-hidden border-r border-slate-200">
          <div className="overflow-y-auto p-6">
            {categories.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                No products stocked yet.
              </p>
            ) : (
              categories.map(([category, items]) => (
                <div key={category} className="mb-6">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition enabled:hover:border-blue-600 enabled:hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <p className="text-sm font-semibold text-slate-900">
                            {p.name}
                          </p>
                          <p className="mt-1 text-sm font-medium text-slate-500">
                            {money(p.price)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
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
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Current Order</h2>
          </div>

          {/* Dedicated barcode search box — scanning while this is focused
              types the code here (the global hook ignores focused fields);
              pressing Enter resolves it and clears the box for the next scan.
              The box keeps focus by default so repeated scans just work. */}
          <div className="border-b border-slate-200 px-6 py-4">
            <label
              htmlFor="scan-input"
              className="block text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Scan barcode / SKU
            </label>
            <input
              id="scan-input"
              ref={scanInputRef}
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  lookUpScannedCode(scanInput)
                  setScanInput('')
                }
              }}
              autoComplete="off"
              autoFocus
              placeholder="Scan or type a SKU, then Enter"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600/10"
            />
          </div>

          {/* Optional customer link for loyalty accrual. Empty option = guest. */}
          <div className="border-b border-slate-200 px-6 py-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Customer
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              <option value="">Guest (no loyalty)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.loyaltyPoints} pts
                </option>
              ))}
            </select>
          </div>

          {/* Payment method selector */}
          <div className="border-b border-slate-200 px-6 py-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900">
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="STORE_CREDIT">Store Credit (On Account)</option>
            </select>
            {paymentMethod === 'STORE_CREDIT' && (
              <p className="mt-1 text-xs text-slate-500">
                {selectedCustomer
                  ? `On-account: ${money(selectedCustomer.currentBalance)} of ${money(selectedCustomer.creditLimit)}`
                  : 'Select a customer to charge on account.'}
              </p>
            )}
            {creditBlocked && (
              <p className="mt-2 text-xs font-medium text-red-600">
                Charge exceeds the credit limit for this customer.
              </p>
            )}
          </div>

          {/* Feedback banner — scanner/validation errors only. */}
          {feedback.kind === 'error' && (
            <p className="mx-6 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {feedback.message}
            </p>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {cart.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No items yet. Tap a product to add it.
              </p>
            ) : (
              <ul className="space-y-3">
                {cart.map((line) => (
                  <li key={line.product.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {line.product.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {money(line.product.price)} each
                      </p>
                    </div>
                    <div className="inline-flex items-center rounded-lg border border-slate-200/80">
                      <button
                        type="button"
                        onClick={() => changeQty(line.product.id, -1)}
                        className="px-2.5 py-1 text-sm text-slate-500 hover:bg-slate-50"
                      >
                        −
                      </button>
                      <span className="px-2.5 py-1 text-sm font-medium text-slate-900">
                        {line.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeQty(line.product.id, 1)}
                        className="px-2.5 py-1 text-sm text-slate-500 hover:bg-slate-50"
                      >
                        +
                      </button>
                    </div>
                    <span className="w-16 text-right text-sm font-semibold text-slate-900">
                      {money(line.product.price * line.qty)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-200 px-6 py-4">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-500">
                <dt>Subtotal</dt>
                <dd>{money(subtotal)}</dd>
              </div>
              <div className="flex justify-between text-slate-500">
                <dt>Tax (8%)</dt>
                <dd>{money(tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-1.5 text-base font-semibold text-slate-900">
                <dt>Grand Total</dt>
                <dd>{money(total)}</dd>
              </div>
            </dl>

            <button
              type="button"
              disabled={cart.length === 0 || pending || creditBlocked}
              onClick={onCheckout}
              className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              {pending ? 'Processing…' : 'Process Payment'}
            </button>
          </div>
        </aside>
      </div>

      {/* Sale-completion modal — receipt preview + print action. The receipt
          itself carries `.print-receipt`, the ONLY element the @media print
          rules in globals.css expose. */}
      {completed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-blue-600/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCompleted(null)
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900">
                  Sale Complete
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Order {completed.id.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompleted(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <svg
                  className="h-5 w-5"
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
                    d="M6 6l12 12M18 6L6 18"
                  />
                </svg>
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto bg-slate-50 px-5 py-5">
              {/* Receipt preview — sized 80mm to match the printed output. */}
              <Receipt
                store={store}
                saleId={completed.id}
                timestamp={completed.timestamp}
                lines={completed.lines}
                subtotal={completed.subtotal}
                tax={completed.tax}
                total={completed.total}
                paymentMethod={completed.paymentMethod}
              />
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setCompleted(null)}
                className="inline-flex items-center rounded-xl border border-slate-200/80 bg-white shadow-sm px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                New Sale
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700"
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
                    d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Z"
                  />
                </svg>
                Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
