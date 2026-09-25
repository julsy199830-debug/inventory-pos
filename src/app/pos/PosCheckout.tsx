'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  Banknote,
  Barcode,
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'framer-motion'
import { createSale, type CreateSaleResult } from '@/app/actions/sales'
import { lockRegister } from '@/lib/actions/auth-actions'
import Receipt, { type ReceiptLine } from './Receipt'
import { useBarcodeScanner } from './useBarcodeScanner'
import TransactionHistory from './TransactionHistory'
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
  /** Sales-tax percentage as a number, e.g. `8.5` means 8.5%. 0 = tax disabled. */
  taxRate: number
}

/** Signed-in operator driving the register — passed down from `page.tsx`. */
export type PosCashier = {
  id: string
  name: string
  role: Role
}

/** Discount kind: a percentage of the base, or a fixed money amount. */
type DiscountType = 'PERCENT' | 'FIXED'

/** A discount request — the server re-validates and re-applies it against the
 *  catalog price, so these values never touch the stored ledger directly. */
type Discount = {
  type: DiscountType
  value: number
}

type CartLine = {
  product: PosProduct
  qty: number
  /** Optional per-line discount (percent of the line, or fixed amount). */
  discount?: Discount | null
}

/** Snapshot of a completed sale — drives the receipt, captured at checkout. */
type CompletedSale = {
  id: string
  timestamp: string
  lines: ReceiptLine[]
  /** Pre-discount catalog subtotal (mirrors Sale.subtotal). */
  subtotal: number
  /** Total discount applied (item + cart) — the receipt's Discount row. */
  discount: number
  tax: number
  total: number
  paymentMethod: string
  /** Cash only: amount handed over, for the receipt's Tendered/Change rows. */
  tendered?: number | null
  change?: number | null
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
  // Dedicated barcode search box value.
  const [scanInput, setScanInput] = useState('')
  // Catalog search box + active category filter chip ('all' = no filter).
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  // Mobile: the cart lives in a slide-over drawer; this toggles it.
  const [cartOpen, setCartOpen] = useState(false)
  // Completed sale awaiting receipt print / dismissal.
  const [completed, setCompleted] = useState<CompletedSale | null>(null)
  // Cart-wide discount request (percent or fixed) — re-applied server-side.
  const [cartDiscount, setCartDiscount] = useState<Discount | null>(null)
  // Cash tender step: modal open flag + the raw tendered-amount input value.
  const [cashStepOpen, setCashStepOpen] = useState(false)
  const [tenderedRaw, setTenderedRaw] = useState('')
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

  // Flat, unique category names for the filter chips.
  const categoryNames = useMemo(() => categories.map(([name]) => name), [categories])

  // Search + category-filtered catalog. Matches product name or SKU
  // (case-insensitive), then drops sections that end up empty.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return categories
      .filter(([name]) => activeCategory === 'all' || name === activeCategory)
      .map(([name, items]) => [
        name,
        q === ''
          ? items
          : items.filter(
              (p) =>
                p.name.toLowerCase().includes(q) ||
                p.sku.toLowerCase().includes(q),
            ),
      ] as const)
      .filter(([, items]) => items.length > 0)
  }, [categories, search, activeCategory])

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

  // ── Per-line discount editing ─────────────────────────────────────────────
  const setLineDiscount = (id: string, discount: Discount | null) =>
    setCart((prev) =>
      prev.map((line) =>
        line.product.id === id ? { ...line, discount } : line,
      ),
    )

  /** Toggle a line's discount on (defaults to a familiar 10% off) or off. */
  const toggleLineDiscount = (id: string) =>
    setCart((prev) =>
      prev.map((line) =>
        line.product.id === id
          ? {
              ...line,
              discount: line.discount ? null : { type: 'PERCENT' as DiscountType, value: 10 },
            }
          : line,
      ),
    )

  const updateLineDiscount = (id: string, patch: Partial<Discount>) =>
    setCart((prev) =>
      prev.map((line) =>
        line.product.id === id && line.discount
          ? { ...line, discount: { ...line.discount, ...patch } }
          : line,
      ),
    )

  const round2 = (n: number) => Math.round(n * 100) / 100

  // Catalog subtotal — pre-discount, matching what the server stores.
  const subtotal = cart.reduce(
    (sum, line) => sum + line.product.price * line.qty,
    0,
  )

  // Money value of one line's discount: percent of the line, or a fixed amount
  // capped at the line total. Mirrors the server's discount math exactly so the
  // register display can never disagree with the stored ledger.
  const lineDiscountMoney = (line: CartLine): number => {
    if (!line.discount) return 0
    const lineTotal = line.product.price * line.qty
    const raw =
      line.discount.type === 'PERCENT'
        ? lineTotal * (line.discount.value / 100)
        : line.discount.value
    return Math.min(raw, lineTotal)
  }

  const itemDiscountTotal = cart.reduce(
    (sum, line) => sum + lineDiscountMoney(line),
    0,
  )
  const cartDiscountRaw = cartDiscount
    ? cartDiscount.type === 'PERCENT'
      ? subtotal * (cartDiscount.value / 100)
      : cartDiscount.value
    : 0
  // Combined discount can never exceed the subtotal (same clamp as the server).
  const discountAmount = round2(Math.min(itemDiscountTotal + cartDiscountRaw, subtotal))
  const taxable = round2(subtotal - discountAmount)

  const taxRatePercent = store.taxRate ?? 0
  const tax = round2(taxable * (taxRatePercent / 100))
  const total = round2(taxable + tax)

  // Cash step: the parsed tendered amount (null while empty/invalid) and the
  // quick-tender chips — exact total plus the smallest clean bill ≥ due.
  const tenderedValue = useMemo(() => {
    if (tenderedRaw.trim() === '') return null
    const value = Number(tenderedRaw)
    return Number.isFinite(value) && value >= 0 ? value : null
  }, [tenderedRaw])

  const quickTenderOptions = useMemo(() => {
    const fmt = (value: number) => `${store.currencySymbol}${value.toFixed(2)}`
    const options: { label: string; value: number }[] = [
      { label: `Exact ${fmt(round2(total))}`, value: round2(total) },
    ]
    for (const denomination of [50, 100, 200, 500, 1000]) {
      const value = Math.ceil(total / denomination) * denomination
      if (value > total && !options.some((option) => option.value === value)) {
        options.push({ label: fmt(value), value })
      }
    }
    return options
  }, [total, store.currencySymbol])

  const selectedCustomer = customers.find((c) => c.id === customerId)
  const creditBlocked =
    paymentMethod === 'STORE_CREDIT' &&
    (!selectedCustomer ||
      selectedCustomer.currentBalance + total > selectedCustomer.creditLimit)

  // Store-symbol money formatter — the same glyph the Receipt uses, so the cart
  // and the printed slip can never disagree (defaults to ₱ via StoreSetting).
  const money = (value: number) => `${store.currencySymbol}${value.toFixed(2)}`

  function onCheckout() {
    if (cart.length === 0 || pending || creditBlocked) return
    // Cash gets a tender step (amount handed over → change due); card and
    // store credit settle for the exact total, so they check out directly.
    if (paymentMethod === 'CASH') {
      setTenderedRaw('')
      setCashStepOpen(true)
      return
    }
    void completeSale(null)
  }

  async function completeSale(tenderedAmount: number | null) {
    // Standard React state only — no try/catch swallowing, no DOM poking. The
    // action resolves with a discriminated `{ ok, ... }`, which is the only
    // thing we branch on. A thrown exception (network/transport) is allowed to
    // surface the framework's nearest error boundary rather than be hidden.
    setPending(true)

    // The server re-derives every money value from the catalog (prices, tax
    // rate, discounts) — this payload only carries the cart's *shape*.
    const res: CreateSaleResult = await createSale({
      customerId: customerId || null,
      paymentMethod,
      discount: cartDiscount ?? undefined,
      items: cart.map((line) => ({
        productId: line.product.id,
        quantity: line.qty,
        discount: line.discount ?? undefined,
      })),
      tendered: tenderedAmount,
      change: tenderedAmount != null && tenderedAmount >= total ? round2(tenderedAmount - total) : null,
    })

    setPending(false)
    if (res.ok) {
      // Snapshot the sale BEFORE clearing the cart — the receipt is a pure
      // function of this state, identical to what the register showed.
      const change =
        tenderedAmount != null && tenderedAmount >= total
          ? round2(tenderedAmount - total)
          : null
      setCompleted({
        id: res.data.id,
        timestamp: new Date().toISOString(),
        lines: cart.map((line) => ({
          name: line.product.name,
          qty: line.qty,
          unitPrice: line.product.price,
        })),
        subtotal,
        discount: discountAmount,
        tax,
        total,
        paymentMethod,
        tendered: tenderedAmount,
        change,
      })
      toast.success('Sale complete', {
        description: `Order ${res.data.id.slice(0, 8).toUpperCase()} · ${money(total)} paid via ${paymentMethod.replaceAll('_', ' ')}`,
      })
      setCart([])
      setCustomerId('')
      setScanInput('')
      setCartDiscount(null)
      setCashStepOpen(false)
    } else {
      // Keep the cash step open on failure so the cashier can retry with the
      // same tendered amount once the problem is resolved.
      toast.error(res.error)
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
        toast.error(`${match.name} is out of stock.`)
      }
    } else {
      toast.error(`No product found for "${code.trim()}".`)
    }
  }

  // Global keyboard-emulation scanner: fast key bursts ending in Enter. The
  // hook ignores keystrokes typed into text fields (customer select, barcode
  // box), so a physical scan while a field is focused types into that field
  // instead of the buffer; when nothing is focused it resolves here.
  useBarcodeScanner(lookUpScannedCode)

  // ── Cart panel ──────────────────────────────────────────────────────────
  // The order surface (scan box, customer, payment, cart lines) is defined
  // ONCE and rendered in two places — the sticky desktop sidebar and the
  // mobile slide-over drawer — so the register can never drift between them.
  const cartBody = (
    <>
      {/* Dedicated barcode search box — scanning while this is focused types
          the code here (the global hook ignores focused fields); pressing
          Enter resolves it and clears the box for the next scan. The box
          keeps focus by default so repeated scans just work. */}
      <div className="border-b border-slate-800 px-5 py-4">
        <label
          htmlFor="scan-input"
          className="block text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          Scan barcode / SKU
        </label>
        <div className="relative mt-1">
          <Barcode
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
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
            className="h-10 w-full rounded-xl border border-slate-800 bg-slate-900 pl-9 pr-3 font-mono text-sm text-slate-100 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
        </div>
      </div>

      {/* Optional customer link for loyalty accrual. Empty option = guest. */}
      <div className="border-b border-slate-800 px-5 py-4">
        <label
          htmlFor="customer-select"
          className="block text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          Customer
        </label>
        <select
          id="customer-select"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
        >
          <option value="">Guest (no loyalty)</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.loyaltyPoints} pts
            </option>
          ))}
        </select>
      </div>

      {/* Payment method — segmented control, touch-friendly. */}
      <div className="border-b border-slate-800 px-5 py-4">
        <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">
          Payment Method
        </span>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(
            [
              { value: 'CASH', label: 'Cash', icon: Banknote },
              { value: 'CARD', label: 'Card', icon: CreditCard },
              { value: 'STORE_CREDIT', label: 'Credit', icon: Wallet },
            ] as const
          ).map(({ value, label, icon: Icon }) => {
            const active = paymentMethod === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setPaymentMethod(value)}
                aria-pressed={active}
                className={[
                  'inline-flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition active:scale-[0.98]',
                  active
                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-indigo-500/50 hover:text-indigo-300',
                ].join(' ')}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            )
          })}
        </div>
        {paymentMethod === 'STORE_CREDIT' && (
          <p className="mt-2 text-xs text-slate-500">
            {selectedCustomer
              ? `On-account: ${money(selectedCustomer.currentBalance)} of ${money(selectedCustomer.creditLimit)}`
              : 'Select a customer to charge on account.'}
          </p>
        )}
        {creditBlocked && (
          <p className="mt-2 text-xs font-medium text-red-400">
            Charge exceeds the credit limit for this customer.
          </p>
        )}
      </div>


      {/* Cart lines */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {cart.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            No items yet. Tap a product to add it.
          </p>
        ) : (
          <AnimatePresence initial={false}>
            <ul className="space-y-3">
              {cart.map((line) => (
                <motion.li
                  key={line.product.id}
                  initial={{ opacity: 0, height: 0, y: -10, scale: 0.96 }}
                  animate={{ opacity: 1, height: 'auto', y: 0, scale: 1 }}
                  exit={{ opacity: 0, height: 0, y: -10, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="flex items-start gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm"
                >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {line.product.name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {money(line.product.price)} each
                  </p>
                  {/* Per-line discount: a small toggle + inline %/₱ editor.
                      The server re-applies the discount against the catalog
                      price at checkout, so this only drives the display. */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleLineDiscount(line.product.id)}
                      aria-pressed={!!line.discount}
                      className={[
                        'rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors',
                        line.discount
                          ? 'bg-violet-100 text-violet-300 ring-1 ring-violet-200'
                          : 'text-slate-400 ring-1 ring-slate-700 hover:bg-slate-800 hover:text-slate-200',
                      ].join(' ')}
                    >
                      {line.discount
                        ? `Disc −${money(lineDiscountMoney(line))}`
                        : 'Disc'}
                    </button>
                    {line.discount && (
                      <span className="inline-flex items-center gap-1">
                        <select
                          value={line.discount.type}
                          onChange={(e) =>
                            updateLineDiscount(line.product.id, {
                              type: e.target.value as DiscountType,
                            })
                          }
                          aria-label={`Discount type for ${line.product.name}`}
                          className="h-7 rounded-md border border-slate-700 bg-slate-900 px-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="PERCENT">%</option>
                          <option value="FIXED">{store.currencySymbol}</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          max={line.discount.type === 'PERCENT' ? 100 : undefined}
                          step="0.01"
                          value={line.discount.value}
                          onChange={(e) => {
                            const value = Number(e.target.value)
                            if (Number.isFinite(value) && value >= 0) {
                              updateLineDiscount(line.product.id, { value })
                            }
                          }}
                          aria-label={`Discount value for ${line.product.name}`}
                          className="h-7 w-16 rounded-md border border-slate-700 px-1.5 text-xs tabular-nums text-slate-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </span>
                    )}
                  </div>
                </div>
                <div className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/60 px-1.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => changeQty(line.product.id, -1)}
                    aria-label={`Decrease ${line.product.name} quantity`}
                    className="rounded p-1.5 text-slate-500 transition-all duration-200 hover:bg-slate-800 hover:text-indigo-300 active:scale-[0.95]"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-7 px-1 text-center text-sm font-medium text-slate-100 transition-all duration-200">
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => changeQty(line.product.id, 1)}
                    aria-label={`Increase ${line.product.name} quantity`}
                    className="rounded p-1.5 text-slate-500 transition-all duration-200 hover:bg-slate-800 hover:text-indigo-300 active:scale-[0.95]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {line.discount ? (
                    <>
                      <span className="text-xs text-slate-400 line-through">
                        {money(line.product.price * line.qty)}
                      </span>
                      <span className="text-sm font-semibold text-violet-300">
                        {money(line.product.price * line.qty - lineDiscountMoney(line))}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-slate-100">
                      {money(line.product.price * line.qty)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setCart((prev) =>
                        prev.filter((l) => l.product.id !== line.product.id),
                      )
                    }
                    aria-label={`Remove ${line.product.name} from order`}
                    className="rounded-lg p-1.5 text-slate-300 transition-all duration-200 hover:bg-red-500/150/10 hover:text-red-400 active:scale-[0.95]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                </motion.li>
              ))}
            </ul>
          </AnimatePresence>
        )}
      </div>
    </>
  )

  // Totals + payment footer — shared by the desktop sidebar and mobile drawer.
  const cartFooter = (
    <div className="border-t border-slate-800 px-5 py-4">
      {/* Order-wide discount: toggle + inline %/₱ editor, applied after the
          per-line discounts and re-validated server-side at checkout. */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() =>
            setCartDiscount(cartDiscount ? null : { type: 'PERCENT', value: 10 })
          }
          aria-pressed={!!cartDiscount}
          className={[
            'rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
            cartDiscount
              ? 'bg-violet-100 text-violet-300 ring-1 ring-violet-200'
              : 'text-slate-500 ring-1 ring-slate-700 hover:bg-slate-800 hover:text-slate-200',
          ].join(' ')}
        >
          Order discount
        </button>
        {cartDiscount && (
          <span className="inline-flex items-center gap-1.5">
            <select
              value={cartDiscount.type}
              onChange={(e) =>
                setCartDiscount({ ...cartDiscount, type: e.target.value as DiscountType })
              }
              aria-label="Order discount type"
              className="h-8 rounded-lg border border-slate-700 bg-slate-900 px-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="PERCENT">%</option>
              <option value="FIXED">{store.currencySymbol}</option>
            </select>
            <input
              type="number"
              min={0}
              max={cartDiscount.type === 'PERCENT' ? 100 : undefined}
              step="0.01"
              value={cartDiscount.value}
              onChange={(e) => {
                const value = Number(e.target.value)
                if (Number.isFinite(value) && value >= 0) {
                  setCartDiscount({ ...cartDiscount, value })
                }
              }}
              aria-label="Order discount value"
              className="h-8 w-20 rounded-lg border border-slate-700 px-2 text-xs tabular-nums text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setCartDiscount(null)}
              aria-label="Clear order discount"
              className="rounded-md px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between text-slate-500">
          <dt>Subtotal</dt>
          <dd>{money(subtotal)}</dd>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between font-medium text-violet-300">
            <dt>Discount</dt>
            <dd>−{money(discountAmount)}</dd>
          </div>
        )}
        <div className="flex justify-between text-slate-500">
          <dt>Tax ({store.taxRate}%)</dt>
          <dd>{money(tax)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 shadow-md shadow-indigo-600/25">
        <span className="text-sm font-medium text-indigo-100">Grand Total</span>
        <span className="text-xl font-bold tabular-nums text-white">
          {money(total)}
        </span>
      </div>
      <button
        type="button"
        disabled={cart.length === 0 || pending || creditBlocked}
        onClick={onCheckout}
        className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-4 text-base font-semibold text-white shadow-sm shadow-indigo-600/30 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
      >
        {pending ? 'Processing…' : 'Process Payment'}
      </button>
      {cart.length > 0 && !pending && (
        <button
          type="button"
          onClick={() => {
            setCart([])
            setCustomerId('')
            setScanInput('')
          }}
          className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-300 transition-all duration-200 hover:bg-slate-950 hover:text-slate-100 active:scale-[0.98]"
        >
          Clear order
        </button>
      )}
    </div>
  )

  // Desktop: sticky right-hand cart sidebar (hidden below `md`).
  const cartPanel = (
    <aside className="hidden w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white md:flex lg:w-[400px]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-100">Current Order</h2>
        {cart.length > 0 && (
          <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-semibold text-indigo-300">
            {cart.reduce((n, l) => n + l.qty, 0)} items
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{cartBody}</div>
      {cartFooter}
    </aside>
  )


  return (
    <div className="flex h-screen w-full flex-col bg-slate-100">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Image
            src="/Logo final.png"
            alt="InvPos"
            width={120}
            height={120}
            priority
            className="h-10 w-auto object-contain"
          />
          {cashier.role === 'ADMIN' || cashier.role === 'MANAGER' ? (
            <>
              <Link
                href="/"
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-slate-950 hover:text-slate-100">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Back to Dashboard</span>
                <span className="sm:hidden">Back</span>
              </Link>
              <nav
                className="hidden items-center gap-2 text-sm sm:flex"
                aria-label="Breadcrumb"
              >
                <Link
                  href="/"
                  className="font-medium text-slate-500 transition-colors hover:text-indigo-300"
                >
                  Dashboard
                </Link>
                <span aria-hidden className="text-slate-300">
                  /
                </span>
                <span className="font-semibold text-slate-100">Point of Sale</span>
              </nav>
            </>
          ) : (
            // Cashiers have no dashboard access, so swap the navigation for a
            // register title + operator badge instead of a dead link.
            <div className="flex min-w-0 items-center gap-3">
              <span className="truncate text-base font-semibold tracking-tight text-slate-100">
                &apos;InvPos Register&apos;
              </span>
              <span className="hidden items-center gap-2 rounded-full bg-indigo-500/15 px-3 py-1.5 text-sm font-medium text-indigo-300 ring-1 ring-indigo-500/30 md:inline-flex">
                <span className="h-2 w-2 rounded-full bg-indigo-500/150" />
                {cashier.name} · {cashier.role.charAt(0) + cashier.role.slice(1).toLowerCase()}
              </span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 ring-1 ring-slate-700">
            <span className="h-2 w-2 rounded-full bg-indigo-500/150" />
            <span className="hidden sm:inline">Register #1 · </span>Online
          </span>
          <span className="hidden items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 md:inline-flex">
            {cashier.name}
          </span>
          <TransactionHistory canVoid={cashier.role === 'ADMIN' || cashier.role === 'MANAGER'} />
          <button
            type="button"
            onClick={() => lockRegister()}
            className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-slate-950"
          >
            Lock
          </button>
        </div>
      </header>

      {/* ── Split screen: catalog (left) + cart (right) ───────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Product catalog */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-slate-800">
          {/* Catalog toolbar: search + category filter chips */}
          <div className="border-b border-slate-800 bg-slate-950 px-4 py-3 sm:px-6">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products or SKU…"
                autoComplete="off"
                className="h-10 w-full rounded-xl border border-slate-800 bg-slate-900 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <CategoryChip
                active={activeCategory === 'all'}
                onClick={() => setActiveCategory('all')}
              >
                All
              </CategoryChip>
              {categoryNames.map((name) => (
                <CategoryChip
                  key={name}
                  active={activeCategory === name}
                  onClick={() => setActiveCategory(name)}
                >
                  {name}
                </CategoryChip>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-500">
                {products.length === 0
                  ? 'No products stocked yet.'
                  : `No products match "${search.trim()}".`}
              </p>
            ) : (
              filtered.map(([category, items]) => (
                <div key={category} className="mb-6">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {category}
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                    {items.map((p) => {
                      const out = p.stock <= 0
                      const low = !out && p.stock <= 5
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={out}
                          onClick={() => addToCart(p)}
                          aria-label={`Add ${p.name} to order`}
                          className="group relative flex min-h-[116px] flex-col rounded-xl border border-slate-800 bg-slate-900 p-4 text-left shadow-sm transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:shadow-md enabled:hover:border-indigo-500/50 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {out && (
                            <span className="absolute right-3 top-3 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400 ring-1 ring-red-500/30">
                              Out
                            </span>
                          )}
                          <p className="min-w-0 truncate pr-10 text-sm font-semibold text-slate-100 group-hover:text-indigo-300">
                            {p.name}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-400">
                            {p.sku}
                          </p>
                          <p className="mt-auto pt-3 text-sm font-semibold text-indigo-300">
                            {money(p.price)}
                          </p>
                          <p
                            className={
                              out
                                ? 'mt-0.5 text-xs text-red-500'
                                : low
                                  ? 'mt-0.5 text-xs font-medium text-amber-600'
                                  : 'mt-0.5 text-xs text-slate-400'
                            }
                          >
                            {out
                              ? 'Out of stock'
                              : low
                                ? `${p.stock} left — low`
                                : `${p.stock} in stock`}
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

        {cartPanel}
      </div>

      {/* ── Mobile: sticky cart summary bar ────────────────────────────── */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] md:hidden">
          <div>
            <p className="text-xs text-slate-500">
              {cart.length} item{cart.length === 1 ? '' : 's'}
            </p>
            <p className="text-base font-semibold text-slate-100">{money(total)}</p>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/30 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
          >
            <ShoppingCart className="h-4 w-4" />
            View Cart
          </button>
        </div>
      )}

      {/* ── Mobile: cart slide-over drawer ─────────────────────────────── */}
      <AnimatePresence>
        {cartOpen && (
          <motion.div
            className="fixed inset-0 z-50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Current order"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
              onClick={() => setCartOpen(false)}
            />
            <motion.div
              className="absolute inset-y-0 right-0 flex w-[88%] max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3, ease: 'easeOut' }}
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-100">Current Order</h2>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                  aria-label="Close cart"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">{cartBody}</div>
              {cartFooter}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Sale-completion modal — receipt preview + print action. The receipt
          itself carries `.print-receipt`, the ONLY element the @media print
          rules in globals.css expose. */}
      <AnimatePresence>
        {completed && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setCompleted(null)
            }}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          >
            <motion.div
              className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            >
            <div className="flex items-start justify-between border-b border-slate-700 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 ring-1 ring-indigo-500/30">
                  <CheckCircle2 className="h-5 w-5 text-indigo-300" />
                </span>
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-slate-100">
                    Sale Complete
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Order {completed.id.slice(0, 8).toUpperCase()}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCompleted(null)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto bg-slate-100 px-5 py-5">
              {/* Receipt preview — sized 80mm to match the printed output. */}
              <Receipt
                store={store}
                saleId={completed.id}
                timestamp={completed.timestamp}
                lines={completed.lines}
                subtotal={completed.subtotal}
                discount={completed.discount}
                tax={completed.tax}
                total={completed.total}
                paymentMethod={completed.paymentMethod}
                tendered={completed.tendered}
                change={completed.change}
              />
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-700 px-5 py-4">
              <button
                type="button"
                onClick={() => setCompleted(null)}
                className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-950"
              >
                New Sale
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98]"
              >
                <Printer className="h-4 w-4" />
                Print Receipt
              </button>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Cash tender step ───────────────────────────────────────────── */}
      {/* Collect the amount handed over and compute change due BEFORE the
          sale is written. Confirming runs the same completeSale path — the
          tendered value only feeds the receipt's Tendered/Change rows; the
          ledger always stores the exact discounted total. */}
      <AnimatePresence>
        {cashStepOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget && !pending) setCashStepOpen(false)
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="w-full max-w-sm overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              role="dialog"
              aria-modal="true"
              aria-label="Collect cash payment"
            >
              <div className="border-b border-slate-700 px-5 py-4">
                <h2 className="text-base font-semibold tracking-tight text-slate-100">
                  Collect Cash
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Amount due{' '}
                  <span className="font-semibold tabular-nums text-slate-100">
                    {money(total)}
                  </span>
                </p>
              </div>

              <div className="px-5 py-4">
                <label
                  htmlFor="tendered-input"
                  className="block text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Tendered amount
                </label>
                <input
                  id="tendered-input"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  value={tenderedRaw}
                  onChange={(e) => setTenderedRaw(e.target.value)}
                  placeholder="0.00"
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 font-mono text-lg tabular-nums text-slate-100 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                />
                {/* Quick-tender chips: exact total + the smallest clean bill. */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {quickTenderOptions.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setTenderedRaw(String(option.value))}
                      className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-indigo-500/50 hover:text-indigo-300"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {tenderedValue === null ? (
                  <p className="mt-3 text-xs text-slate-400">
                    Enter the amount the customer handed over.
                  </p>
                ) : tenderedValue < total ? (
                  <p className="mt-3 text-xs font-medium text-red-400">
                    Tendered amount is less than the total due.
                  </p>
                ) : (
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-100">
                    <span className="text-sm font-medium text-emerald-800">
                      Change due
                    </span>
                    <span className="text-xl font-bold tabular-nums text-emerald-700">
                      {money(round2(tenderedValue - total))}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-700 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setCashStepOpen(false)}
                  disabled={pending}
                  className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void completeSale(tenderedValue)}
                  disabled={tenderedValue === null || tenderedValue < total || pending}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
                >
                  {pending ? 'Processing…' : 'Complete Sale'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Category filter chip for the catalog toolbar. `active` renders the filled
 * blue state; inactive chips are white with a slate hairline. Touch-sized
 * (rounded-full) for the register's tap-first workflow.
 */
function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition active:scale-[0.97]',
        active
          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
          : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-indigo-500/50 hover:text-indigo-300',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
