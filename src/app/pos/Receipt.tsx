'use client'

/**
 * Printable thermal receipt.
 *
 * Rendered inside the sale-completion modal on screen so the cashier can
 * preview the sale, but its real job is to be the ONLY element printed when
 * "Print Receipt" is pressed: the global `@media print` rules in `globals.css`
 * hide every other element (`body *` → `visibility: hidden`) and expose this
 * tree (`.print-receipt` → `visibility: visible`), positioned at the top-left
 * at a fixed 80mm width — the standard thermal-roll dimension for 80mm / 58mm
 * printers — so the layout is never squeezed into an A4 column.
 *
 * The receipt is a pure function of the sale the client just completed: it
 * snapshots the cart lines, totals, order id and timestamp from `PosCheckout`
 * state at the moment of checkout, plus the store header loaded server-side
 * from `StoreSetting`. Nothing is re-queried; the component cannot refetch,
 * which keeps the printed record identical to what the register showed.
 */
export type ReceiptLine = {
  name: string
  qty: number
  unitPrice: number
}

/** Store identity shown on the receipt header — a subset of `StoreSetting`. */
export type ReceiptStore = {
  storeName: string
  address: string | null
  phone: string | null
  /** Short currency glyph, e.g. "₱", "€", "¥". */
  currencySymbol: string
}

export default function Receipt({
  store,
  saleId,
  timestamp,
  lines,
  subtotal,
  tax,
  total,
  discount = 0,
  paymentMethod,
  thanks = 'Thank you for your purchase!',
}: {
  store: ReceiptStore
  /** Complete (not truncated) sale id — the POS shows short ids elsewhere. */
  saleId: string
  /** ISO timestamp captured at checkout. */
  timestamp: string
  lines: ReceiptLine[]
  subtotal: number
  tax: number
  total: number
  /** Optional discount amount; a 0 value renders no Discount row. */
  discount?: number
  paymentMethod: string
  thanks?: string
}) {
  const money = (value: number) =>
    `${store.currencySymbol}${value.toFixed(2)}`

  const formattedTimestamp = new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  return (
    <div className="print-receipt mx-auto w-[80mm] bg-white px-1 font-mono text-[11px] leading-snug text-black">
      {/* ── Store header ─────────────────────────────────────────────── */}
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-wide">
          {store.storeName}
        </p>
        {store.address && <p className="mt-0.5 whitespace-pre-line">{store.address}</p>}
        {store.phone && <p className="mt-0.5">{store.phone}</p>}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      {/* ── Order meta ───────────────────────────────────────────────── */}
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>Order</span>
          <span className="max-w-[55mm] truncate">{saleId.toUpperCase()}</span>
        </div>
        <div className="flex justify-between">
          <span>Date</span>
          <span>{formattedTimestamp}</span>
        </div>
        <div className="flex justify-between">
          <span>Payment</span>
          <span>{paymentMethod}</span>
        </div>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      {/* ── Itemized list ───────────────────────────────────────────── */}
      <div className="space-y-1">
        {lines.map((line, i) => (
          <div key={i}>
            <p className="truncate">{line.name}</p>
            <div className="flex justify-between">
              <span>
                {line.qty} × {money(line.unitPrice)}
              </span>
              <span>{money(line.qty * line.unitPrice)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      {/* ── Totals ───────────────────────────────────────────────────── */}
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{money(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span>−{money(discount)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Tax</span>
          <span>{money(tax)}</span>
        </div>
        <div className="flex justify-between pt-0.5 text-sm font-bold">
          <span>Total</span>
          <span>{money(total)}</span>
        </div>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      {/* ── Thank-you ────────────────────────────────────────────────── */}
      <p className="pb-1 text-center">{thanks}</p>
    </div>
  )
}