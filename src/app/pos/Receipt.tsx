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
import type { FormatSettings } from '@/lib/format'
import { formatDateTime, formatMoney } from '@/lib/format'

export type ReceiptStore = {
  storeName: string
  address: string | null
  phone: string | null
  /** Short currency glyph, e.g. "₱", "€", "¥". */
  currencySymbol: string
  /**
   * Phase 6: the resolved global settings. The receipt prints through this, so
   * a reprint always uses the currency/date format the store is configured for
   * rather than whatever the component last hardcoded.
   */
  format: FormatSettings
}

/** One line of a REFUND receipt, reusing the sale line shape. */
export type RefundReceiptLine = ReceiptLine

/** Payment methods, spelled the way a customer reads them. */
const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  STORE_CREDIT: 'Store Credit',
}

/**
 * A label/value row, label left and value right-aligned, both tabular so columns
 * line up down the slip.
 *
 * Hoisted to module scope deliberately: defined inside Receipt it would be a new
 * component type on every render, which the React Compiler rules reject and
 * which would remount the row subtree on each keystroke of the parent.
 */

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
<div className={`flex justify-between gap-2 ${strong ? 'font-bold' : ''}`}>
<span className="shrink-0">{label}</span>
<span className="truncate text-right tabular-nums">{value}</span>
</div>
)

export default function Receipt({
  store,
  saleId,
  timestamp,
  lines,
  subtotal,
  tax,
  total,
  discount = 0,
  redeemedPoints = 0,
  redemptionAmount = 0,
  earnedPoints = 0,
  paymentMethod,
  tendered = null,
  change = null,
  cashierName = null,
  customerName = null,
  taxRate = 0,
  refundLines = [],
  refundTotal = 0,
  originalTotal = null,
  thanks = 'Thank you for shopping with us!',
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
  /** Phase 1d: points spent at checkout. 0 renders no Loyalty rows. */
  redeemedPoints?: number
  /** Phase 1d: peso value credited for `redeemedPoints`. */
  redemptionAmount?: number
  /** Phase 1d: points this sale earned (0 for a guest sale). */
  earnedPoints?: number
  paymentMethod: string
  /** Cash only: amount the customer handed over (renders a Tendered row). */
  tendered?: number | null
  /** Cash only: change due (renders a Change row when non-negative). */
  change?: number | null
  /** Phase 3: who rang the sale up. A receipt without this is unauditable. */
  cashierName?: string | null
  /** Phase 3: the customer, or null for a walk-in. */
  customerName?: string | null
  /** Phase 3: store tax percentage, so the VAT line is self-explanatory. */
  taxRate?: number
  /** Phase 3: when set, this is a REFUND slip, not a sale. */
  refundLines?: RefundReceiptLine[]
  /** Phase 3: total refunded on this slip. */
  refundTotal?: number
  /** Phase 3: the original sale total a refund is drawn against. */
  originalTotal?: number | null
  thanks?: string
}) {
  // Phase 6: the receipt prints through the ONE shared formatter, using the
  // store's configured symbol and locale. The previous version hardcoded the
  // glyph off the prop AND dropped thousands grouping, so a reprint could
  // disagree with the till that produced the sale.
  const money = (value: number) => formatMoney(value, store.format)

  const formattedTimestamp = formatDateTime(new Date(timestamp), store.format)

  const isRefund = refundLines.length > 0
  const unitCount = lines.reduce((n, l) => n + l.qty, 0)
  const refundUnitCount = refundLines.reduce((n, l) => n + l.qty, 0)
  const paymentLabel = PAYMENT_LABELS[paymentMethod] ?? paymentMethod

  return (
    <div className="print-receipt mx-auto w-[80mm] bg-white px-2 py-3 font-mono text-[11px] leading-snug text-black">
      {/* ── Store header ─────────────────────────────────────────────── */}
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-wider">{store.storeName}</p>
        {store.address && <p className="mt-1 whitespace-pre-line text-[10px]">{store.address}</p>}
        {store.phone && <p className="text-[10px]">{store.phone}</p>}
      </div>

      <div className="my-2 border-t border-dashed border-black/50" />

      {/* ── A refund slip is titled as one. A customer holding a slip that
          reads "TOTAL" with no other signal has no way to tell it is money
          coming back. ───────────────────────────────────────────────── */}
      {isRefund && (
        <div className="mb-2 border border-black px-2 py-1 text-center font-bold uppercase tracking-widest">
          Refund receipt
        </div>
      )}

      {/* ── Transaction meta ─────────────────────────────────────────── */}
      <div className="space-y-0.5">
        <Row label="Receipt #" value={saleId.toUpperCase()} />
        <Row label="Date" value={formattedTimestamp} />
        {cashierName && <Row label="Cashier" value={cashierName} />}
        <Row label="Customer" value={customerName ?? 'Walk-in'} />
        {!isRefund && <Row label="Payment" value={paymentLabel} />}
      </div>

      <div className="my-2 border-t border-dashed border-black/50" />

      {/* ── Items ────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        {lines.map((line, i) => (
          <div key={i} className="break-words">
            <p className="font-semibold">{line.name}</p>
            <div className="flex justify-between gap-2">
              <span>
                {line.qty} × {money(line.unitPrice)}
              </span>
              <span className="tabular-nums">{money(line.qty * line.unitPrice)}</span>
            </div>
          </div>
        ))}
        <p className="text-[10px]">
          {unitCount} item{unitCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="my-2 border-t border-dashed border-black/50" />

      {/* ── Totals ───────────────────────────────────────────────────── */}
      <div className="space-y-0.5">
        <Row label="Subtotal" value={money(subtotal)} />
        {discount > 0 && <Row label="Discount" value={`−${money(discount)}`} />}
        {/* The VAT row is omitted entirely when tax is off, rather than printed
            as a zero line that reads like a charge. */}
        {tax > 0 && (
          <Row label={taxRate > 0 ? `VAT (${taxRate}%)` : 'VAT'} value={money(tax)} />
        )}
        {redemptionAmount > 0 && (
          <Row
            label={`Loyalty (${redeemedPoints} pts)`}
            value={`−${money(redemptionAmount)}`}
          />
        )}
        <div className="mt-1 flex justify-between gap-2 border-t border-black/50 pt-1 text-sm font-bold">
          <span>{isRefund ? 'Sale total' : 'Total'}</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
        {tendered != null && <Row label="Tendered" value={money(tendered)} />}
        {change != null && change >= 0 && (
          <Row label="Change" value={money(change)} />
        )}
        {earnedPoints > 0 && (
          <Row label="Points earned" value={String(earnedPoints)} />
        )}
      </div>

      {/* ── Refund detail ────────────────────────────────────────────── */}
      {isRefund && (
        <>
          <div className="my-2 border-t border-dashed border-black/50" />
          <p className="mb-1 font-bold uppercase tracking-wide">Returned items</p>
          <div className="space-y-1.5">
            {refundLines.map((line, i) => (
              <div key={i} className="break-words">
                <p className="font-semibold">{line.name}</p>
                <div className="flex justify-between gap-2">
                  <span>
                    {line.qty} × {money(line.unitPrice)}
                  </span>
                  <span className="tabular-nums">{money(line.qty * line.unitPrice)}</span>
                </div>
              </div>
            ))}
            <p className="text-[10px]">
              {refundUnitCount} unit{refundUnitCount === 1 ? '' : 's'} returned
            </p>
          </div>
          <div className="mt-1 space-y-0.5">
            {originalTotal != null && (
              <Row label="Original total" value={money(originalTotal)} />
            )}
            <div className="mt-1 flex justify-between gap-2 border-t border-black/50 pt-1 text-sm font-bold">
              <span>Refunded</span>
              <span className="tabular-nums">−{money(refundTotal)}</span>
            </div>
            {originalTotal != null && (
              <Row
                label="Balance kept"
                value={money(Math.max(0, originalTotal - refundTotal))}
              />
            )}
          </div>
        </>
      )}

      <div className="my-2 border-t border-dashed border-black/50" />

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <p className="pb-1 text-center">{thanks}</p>
      <p className="text-center text-[9px]">Keep this receipt for returns or exchanges.</p>
    </div>
  )
}
