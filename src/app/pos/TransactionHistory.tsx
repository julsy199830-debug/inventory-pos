'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, Printer, Receipt as ReceiptIcon, Search, Undo2 } from 'lucide-react'
import Receipt, { type ReceiptStore } from './Receipt'
import { toast } from 'sonner'
import { Modal } from '@/app/_components/ui/Modal'
import { refundSale, voidSale } from '@/app/actions/sales'
import { refundValueFor, round2, saleItemUnitValues } from '@/lib/loyalty'
import { formatMoney } from '@/lib/format'
import { getHistoryFacets, getRecentSales, getSaleDetails } from './history-actions'
import type {
  HistoryFacet,
  HistoryFacets,
  HistoryScope,
  SaleDetailsEntry,
  SaleHistoryEntry,
} from './history-types'

/**
 * POS transaction history + sale details + full-void UI.
 *
 * Lives behind a single "Transactions" header button so the checkout surface is
 * untouched. Viewing is open to any signed-in cashier; the Void action is only
 * *rendered* for ADMIN/MANAGER — real authorization is enforced inside the
 * `voidSale` server action, so hiding the button is convenience, not security.
 *
 * Only FULL void is supported (Phase 4 scope): no partial refunds, no
 * "Refunded" status. Cash-drawer and card-terminal reversal are intentionally
 * out of scope — the UI warns instead of pretending.
 */

/**
 * The "what will happen" panel shared by the void and refund confirmations.
 *
 * Both dialogs describe their consequences in the same shape for a reason: a
 * cashier moving between them should not have to learn a new layout each time,
 * and the destructive action should always be the one with the most explicit
 * consequences on screen.
 *
 * `tone` is the only thing that differs between them — red for void (whole sale
 * reversed), amber for refund (partial return) — which is itself the fastest
 * way to tell the two apart.
 */
function ImpactPanel({
  tone,
  heading,
  effects,
  items,
}: {
  tone: 'void' | 'refund';
  heading: string;
  /** Ordered consequence lines, most important first. */
  effects: string[];
  /** The lines being affected, with their quantities. */
  items: { name: string; qty: number; note?: string }[];
}) {
  const skin =
    tone === 'void'
      ? { wrap: 'bg-red-50 ring-red-200', text: 'text-red-800', strong: 'text-red-900' }
      : { wrap: 'bg-amber-50 ring-amber-200', text: 'text-amber-800', strong: 'text-amber-900' }

  return (
    <div className={`rounded-xl px-3 py-3 ring-1 ${skin.wrap}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${skin.text}`}>
        {heading}
      </p>
      <ul className={`mt-1.5 space-y-1 text-xs ${skin.text}`}>
        {effects.map((effect) => (
          <li key={effect} className="flex gap-1.5">
            <span aria-hidden>•</span>
            <span>{effect}</span>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <ul className={`mt-2.5 space-y-1 border-t pt-2 text-xs ${skin.text} border-current/20`}>
          {items.map((item) => (
            <li key={item.name} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{item.name}</span>
              <span className={`shrink-0 tabular-nums ${skin.strong}`}>
                {item.qty > 0 ? `× ${item.qty}` : ''}
                {item.note ? ` ${item.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One of the history filter dropdowns.
 *
 * Each option carries its count, so a manager can see where the volume is
 * before selecting. An option whose count is zero is disabled rather than
 * hidden: it documents that the value exists in the window while making clear
 * that choosing it returns nothing.
 */
function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: HistoryFacet[];
  allLabel: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Filter by ${label.toLowerCase()}`}
        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.count === 0}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
    </label>
  )
}

const PRESET_REASONS = [
  'Customer cancellation',
  'Wrong item',
  'Wrong quantity',
  'Pricing error',
  'Duplicate transaction',
] as const

/** Refund-specific presets (Phase 1d). Distinct from the void reasons: a refund
 *  is a return of goods, so it is about the goods and their condition. */
const REFUND_REASONS = [
  'Damaged item',
  'Wrong item returned',
  'Customer changed mind',
  'Duplicate purchase',
  'Quality issue',
] as const



const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  STORE_CREDIT: 'Store Credit',
}

type Props = {
  /** Whether the signed-in cashier may void (UI hint only; server enforces). */
  canVoid: boolean
  /**
   * Store identity, so a reprinted receipt carries the same header as the one
   * handed over at the time of sale.
   *
   * Passed down rather than re-queried: `page.tsx` already loaded exactly this
   * `StoreSetting` row for the register, and a reprint is a rendering concern,
   * not a fresh sale. Reusing it keeps the reprint on the same store identity
   * the till is currently configured with.
   */
  store: ReceiptStore
  /** Store tax percentage, printed as "VAT (n%)" when tax is on. */
  taxRate: number
}

export default function TransactionHistory({ canVoid, store, taxRate }: Props) {
  // Phase 6: money renders through the shared formatter. This used to be a
  // module-level `₱${n.toFixed(2)}` with the peso hardcoded, so the history list
  // ignored the store's currency entirely and showed no thousands grouping.
  const money = (value: number) => formatMoney(value, store.format)

  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<HistoryScope>('recent')
  const [query, setQuery] = useState('')
  const [sales, setSales] = useState<SaleHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Detail view
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<SaleDetailsEntry | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  // Phase 4: reprint preview for an already-completed sale.
  const [reprintOpen, setReprintOpen] = useState(false)

  // Void flow
  const [voidOpen, setVoidOpen] = useState(false)
  const [otherMode, setOtherMode] = useState(false)
  const [reason, setReason] = useState('')
  const [voidPending, setVoidPending] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  // Refund flow (Phase 1d). `refundQty` maps a sale-item id to the number of
  // units staged for refund; the dialog is a per-unit picker so a cashier can
  // take back 1 of 3 rather than being forced into a whole-line return.
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundQty, setRefundQty] = useState<Record<string, number>>({})
  const [refundReason, setRefundReason] = useState('')
  const [refundOtherMode, setRefundOtherMode] = useState(false)
  const [refundPending, setRefundPending] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

  // ── Phase 3: filter state ─────────────────────────────────────────────────
  // Each is a single string ('' = "no filter") rather than a nullable one, so
  // the `<select>` can bind straight to it without a null branch. `showFilters`
  // gates the advanced row so the common case - a glance at the last few sales -
  // stays uncluttered on a small screen.
  const [showFilters, setShowFilters] = useState(false)
  const [status, setStatus] = useState('')
  const [payment, setPayment] = useState('')
  const [cashierId, setCashierId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [facets, setFacets] = useState<HistoryFacets | null>(null)

  /** How many of the advanced filters are actually narrowing the list. */
  const activeFilterCount =
    (status ? 1 : 0) +
    (payment ? 1 : 0) +
    (cashierId ? 1 : 0) +
    (customerId ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0)

  const clearAdvancedFilters = useCallback(() => {
    setStatus('')
    setPayment('')
    setCashierId('')
    setCustomerId('')
    setFromDate('')
    setToDate('')
  }, [])

  const refreshList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await getRecentSales({
      query,
      scope,
      status: status || undefined,
      paymentMethod: payment || undefined,
      cashierId: cashierId || undefined,
      customerId: customerId || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
    })
    if (res.ok) setSales(res.data.sales)
    else setError(res.error)
    setLoading(false)
  }, [query, scope, status, payment, cashierId, customerId, fromDate, toDate])

  // The dropdown options follow the same time window as the list, so a cashier
  // is never offered "Ana" for a day she did not work.
  const refreshFacets = useCallback(async () => {
    const res = await getHistoryFacets({ scope })
    if (res.ok) setFacets(res.data)
  }, [scope])

  // (Re)load the list whenever the panel opens or filters change. Debounced so
  // typing in the search box doesn't fire a server action per keystroke.
  //
  // The facets load rides in the same scheduled callback rather than a second
  // effect: they depend on the same `scope`, and scheduling both behind one
  // timeout keeps them off the synchronous effect path (which React flags, and
  // which would otherwise mean two round trips racing on open).
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      void refreshList()
      void refreshFacets()
    }, query ? 250 : 0)
    return () => clearTimeout(t)
  }, [open, refreshList, refreshFacets, query])

  const openDetails = async (saleId: string) => {
    setSelectedId(saleId)
    setDetails(null)
    setDetailsError(null)
    setDetailsLoading(true)
    const res = await getSaleDetails(saleId)
    if (res.ok) setDetails(res.data.sale)
    else setDetailsError(res.error)
    setDetailsLoading(false)
  }

  const openVoid = () => {
    setVoidError(null)
    setReason('')
    setOtherMode(false)
    setVoidOpen(true)
  }

  const submitVoid = async () => {
    const trimmed = reason.trim()
    if (!trimmed || !selectedId || voidPending) return
    setVoidPending(true)
    setVoidError(null)
    const res = await voidSale(selectedId, trimmed)
    setVoidPending(false)
    if (res.ok) {
      toast.success('Sale voided. Inventory and balances have been reversed.')
      setVoidOpen(false)
      await refreshList()
      await openDetails(selectedId) // re-fetch so the detail shows Voided
    } else {
      setVoidError(res.error)
    }
  }

  const closeAll = () => {
    setOpen(false)
    setSelectedId(null)
    setDetails(null)
    setVoidOpen(false)
    setRefundOpen(false)
    setQuery('')
  }

  // ── Refund flow (Phase 1d) ────────────────────────────────────────────
  /** Lines with at least one unit still available to refund. */
  const refundableItems = (details?.items ?? []).filter(
    (it) => it.quantity - it.refundedQuantity > 0,
  )

  /**
   * Phase 3: total units a VOID would put back on the shelf.
   *
   * Summed from the item lines rather than shown as a bare number, so the figure
   * in the consequences panel is traceable to the items listed under it. A void
   * returns every unit of the sale; a refund returns only what is still out.
   */
  const voidUnits = (details?.items ?? []).reduce((n, it) => n + it.quantity, 0)

  const openRefund = () => {
    setRefundError(null)
    setRefundReason('')
    setRefundOtherMode(false)
    // Pre-select nothing: a refund is money out, so the cashier must make a
    // deliberate choice rather than confirming a pre-filled basket.
    setRefundQty({})
    setRefundOpen(true)
  }

  const submitRefund = async () => {
    const trimmed = refundReason.trim()
    if (!selectedId || refundPending) return
    const lines = Object.entries(refundQty)
      .filter(([, qty]) => qty > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }))
    if (lines.length === 0) {
      setRefundError('Choose at least one item to refund.')
      return
    }
    if (!trimmed) {
      setRefundError('A refund reason is required.')
      return
    }
    setRefundPending(true)
    setRefundError(null)
    const res = await refundSale({ saleId: selectedId, lines, reason: trimmed })
    setRefundPending(false)
    if (res.ok) {
      toast.success(`Refunded ${money(res.data.amount)}`, {
        description:
          res.data.status === 'Refunded'
            ? 'The sale is now fully refunded.'
            : `${money(res.data.refundedTotal)} refunded of ${money(details?.totalAmount ?? 0)}.`,
      })
      setRefundOpen(false)
      await refreshList()
      await openDetails(selectedId) // re-fetch so per-line refunded counts update
    } else {
      setRefundError(res.error)
    }
  }

  const trimmedReason = reason.trim()
  const detailsVoided = details != null && details.status !== 'Completed'
  // A sale with refunds can no longer be voided: the void restores the full
  // quantity, which would double-count stock the refund already returned.
  const detailsHasRefunds = details != null && details.refundedAmount > 0
  const canActOnSale = canVoid && !detailsVoided

  /** Staged units for one line, clamped to what is actually still refundable. */
  const stagedFor = (itemId: string, max: number) =>
    Math.min(Math.max(0, refundQty[itemId] ?? 0), max)

  /** Live peso value of the staged refund, from the same lib the server uses. */
  const refundPreview = useMemo(() => {
    if (!details) return 0
    const unitValues = saleItemUnitValues(
      details.items.map((it) => ({ quantity: it.quantity, priceAtSale: it.priceAtSale })),
      details.totalAmount,
    )
    const lines = details.items
      .map((it, i) => ({
        quantity: Math.min(
          Math.max(0, refundQty[it.id] ?? 0),
          it.quantity - it.refundedQuantity,
        ),
        unitValue: round2(unitValues[i] / it.quantity),
      }))
      .filter((l) => l.quantity > 0)
    return refundValueFor(lines, round2(details.totalAmount - details.refundedAmount))
    // `stagedFor` is intentionally inlined above rather than called here: it is
    // a closure over `refundQty` that is itself a dependency, and listing both
    // would defeat the memo. `details` is re-created per fetch.
  }, [details, refundQty])

  /**
   * Phase 3: how many units the staged refund will put back on the shelf.
   *
   * Derived from the same per-line clamp the preview value uses, so the
   * consequence panel can never quote a different number from the amount.
   */
  const refundStagedUnits = useMemo(() => {
    if (!details) return 0
    return details.items.reduce((n, it) => {
      const max = it.quantity - it.refundedQuantity
      return n + Math.min(Math.max(0, refundQty[it.id] ?? 0), max)
    }, 0)
  }, [details, refundQty])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white hover:text-slate-900"
      >
        <ReceiptIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Transactions</span>
      </button>

      {/* ── History list modal ─────────────────────────────────────────── */}
      <Modal
        open={open && !selectedId}
        onClose={closeAll}
        title="Transactions"
        description="Recent sales on this register"
        className="max-w-2xl"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sale ID, customer, or cashier…"
                autoComplete="off"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>
            <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {(
                [
                  ['recent', 'Last 7 days'],
                  ['today', 'Today'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    scope === value
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
              {/* Phase 3: the advanced filters are behind one toggle so the
                  common case stays a single row. The badge tells a manager their
                  filters are still applied after the panel is closed and
                  reopened - otherwise a narrowed list looks like all the sales. */}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                aria-controls="history-advanced-filters"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  showFilters || activeFilterCount > 0
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Filters
                {activeFilterCount > 0 && (
                  <span
                    className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                    aria-label={`${activeFilterCount} filters active`}
                  >
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {showFilters && (
            <div
              id="history-advanced-filters"
              className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
            >
              <FilterSelect
                label="Status"
                value={status}
                onChange={setStatus}
                options={facets?.statuses ?? []}
                allLabel="Any status"
              />
              <FilterSelect
                label="Payment"
                value={payment}
                onChange={setPayment}
                options={facets?.paymentMethods ?? []}
                allLabel="Any payment"
              />
              <FilterSelect
                label="Cashier"
                value={cashierId}
                onChange={setCashierId}
                options={facets?.cashiers ?? []}
                allLabel="Anyone"
              />
              <FilterSelect
                label="Customer"
                value={customerId}
                onChange={setCustomerId}
                options={facets?.customers ?? []}
                allLabel="Anyone"
              />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  From date
                </span>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  To date
                </span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                />
              </label>
              {activeFilterCount > 0 && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <button
                    type="button"
                    onClick={clearAdvancedFilters}
                    className="text-xs font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
                  >
                    Clear {activeFilterCount} filter
                    {activeFilterCount === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <p className="py-10 text-center text-sm text-slate-500">Loading transactions…</p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-red-600">{error}</p>
          ) : sales.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-700">
                {activeFilterCount > 0 || query
                  ? 'No transactions match these filters.'
                  : 'No sales in this window yet.'}
              </p>
              {(activeFilterCount > 0 || query) && (
                <button
                  type="button"
                  onClick={() => {
                    clearAdvancedFilters()
                    setQuery('')
                  }}
                  className="mt-2 text-xs font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
                >
                  Clear filters and search
                </button>
              )}
            </div>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200">
              {sales.map((s) => {
                const voided = s.status !== 'Completed'
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => openDetails(s.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-100"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          <span className="font-mono text-xs text-slate-500">#{s.id.slice(0, 8)}</span>
                          {' · '}
                          {fmtDateTime(s.createdAt)}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {METHOD_LABEL[s.paymentMethod] ?? s.paymentMethod}
                          {s.customerName ? ` · ${s.customerName}` : ''}
                          {s.cashierName ? ` · ${s.cashierName}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {s.refundedAmount > 0 && !voided && (
                          <span
                            className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-500/30"
                            title={`${money(s.refundedAmount)} refunded`}
                          >
                            Refunded
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                            voided
                              ? 'bg-red-500/15 text-red-600 ring-red-500/30'
                              : 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30'
                          }`}
                        >
                          {voided ? 'Voided' : 'Completed'}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">
                          {money(s.totalAmount)}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Modal>

      {/* ── Sale details modal ──────────────────────────────────────────── */}
      <Modal
        open={selectedId !== null}
        onClose={() => {
          setSelectedId(null)
          setDetails(null)
          setDetailsError(null)
        }}
        title="Sale details"
        className="max-w-2xl"
      >
        {detailsLoading ? (
          <p className="py-10 text-center text-sm text-slate-500">Loading sale…</p>
        ) : detailsError ? (
          <p className="py-10 text-center text-sm text-red-600">{detailsError}</p>
        ) : details ? (
          <div className="flex flex-col gap-4">
            {/* Meta */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-sm text-slate-600">#{details.id.slice(0, 8)}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(details.createdAt)}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                  detailsVoided
                    ? 'bg-red-500/15 text-red-600 ring-red-500/30'
                    : 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30'
                }`}
              >
                {detailsVoided ? 'Voided' : 'Completed'}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Cashier</dt>
              <dd className="text-right text-slate-700">{details.cashierName ?? '—'}</dd>
              <dt className="text-slate-500">Customer</dt>
              <dd className="text-right text-slate-700">{details.customerName ?? 'Walk-in'}</dd>
              <dt className="text-slate-500">Payment</dt>
              <dd className="text-right text-slate-700">{METHOD_LABEL[details.paymentMethod] ?? details.paymentMethod}</dd>
            </dl>

            {/* Items */}
            <div className="rounded-xl border border-slate-200">
              <ul className="divide-y divide-slate-200">
                {details.items.map((it) => {
                  const remaining = it.quantity - it.refundedQuantity
                  return (
                    <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate text-slate-700">{it.productName}</p>
                        <p className="text-xs text-slate-500">
                          {it.quantity} × {money(it.priceAtSale)}
                        </p>
                        {it.refundedQuantity > 0 && (
                          <p className="text-xs font-medium text-amber-600">
                            {it.refundedQuantity} of {it.quantity} refunded
                            {remaining > 0 ? ` · ${remaining} still returnable` : ' · fully returned'}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 tabular-nums text-slate-900">
                        {money(it.quantity * it.priceAtSale)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* Totals */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="text-right tabular-nums text-slate-700">{money(details.subtotal)}</dd>
              <dt className="text-slate-500">Discount</dt>
              <dd className="text-right tabular-nums text-slate-700">−{money(details.discountAmount)}</dd>
              <dt className="text-slate-500">Tax</dt>
              <dd className="text-right tabular-nums text-slate-700">{money(details.tax)}</dd>
              {details.redemptionAmount > 0 && (
                <>
                  <dt className="text-slate-500">Loyalty ({details.redeemedPoints} pts)</dt>
                  <dd className="text-right tabular-nums text-emerald-700">
                    −{money(details.redemptionAmount)}
                  </dd>
                </>
              )}
              {details.earnedPoints > 0 && (
                <>
                  <dt className="text-slate-500">Points earned</dt>
                  <dd className="text-right tabular-nums text-slate-700">{details.earnedPoints}</dd>
                </>
              )}
              {detailsHasRefunds && (
                <>
                  <dt className="font-medium text-amber-700">Refunded</dt>
                  <dd className="text-right font-medium tabular-nums text-amber-700">
                    −{money(details.refundedAmount)}
                  </dd>
                </>
              )}
              <dt className="border-t border-slate-200 pt-1 font-semibold text-slate-600">Total</dt>
              <dd className="border-t border-slate-200 pt-1 text-right font-semibold tabular-nums text-slate-900">
                {money(details.totalAmount)}
              </dd>
              {details.tendered != null && (
                <>
                  <dt className="text-slate-500">Tendered</dt>
                  <dd className="text-right tabular-nums text-slate-700">{money(details.tendered)}</dd>
                  <dt className="text-slate-500">Change</dt>
                  <dd className="text-right tabular-nums text-slate-700">{money(details.change ?? 0)}</dd>
                </>
              )}
            </dl>

            {/* Void information — only for voided sales */}
            {detailsVoided && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-red-700">
                  <Ban className="h-4 w-4" /> Voided transaction
                </p>
                <p className="mt-1 text-red-200/90">Reason: {details.voidReason ?? '—'}</p>
                <p className="text-red-200/90">
                  Voided {details.voidedAt ? fmtDateTime(details.voidedAt) : '—'}
                  {details.voidedBy ? ` · by user #${details.voidedBy.slice(0, 8)}` : ''}
                </p>
              </div>
            )}

            {/* Refund audit trail (Phase 1d) — who took money back, when, why. */}
            {details.refunds.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-700">
                  <Undo2 className="h-4 w-4" /> Refund history
                </p>
                <ul className="mt-1.5 space-y-1">
                  {details.refunds.map((r) => (
                    <li key={r.id} className="text-xs text-amber-200/90">
                      {money(r.amount)} · {r.reason} · {fmtDateTime(r.createdAt)}
                      {r.cashierName ? ` · ${r.cashierName}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Void / Refund entry points — UI hints only; the server actions
                enforce the role. Void is hidden once a refund exists because the
                two paths would restore the same stock twice. */}
            {canActOnSale && (
              <div className="mt-1 flex flex-wrap gap-2">
                {refundableItems.length > 0 && (
                  <button
                    type="button"
                    onClick={openRefund}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  >
                    <Undo2 className="h-4 w-4" /> Refund items
                  </button>
                )}
                {!detailsHasRefunds && (
                  <button
                    type="button"
                    onClick={openVoid}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  >
                    <Ban className="h-4 w-4" /> Void this sale
                  </button>
                )}
              </div>
            )}
            {canVoid && detailsHasRefunds && !detailsVoided && (
              <p className="mt-1 text-xs text-slate-500">
                This sale has refunds against it, so it can no longer be voided.
              </p>
            )}
            {/* ── Reprint (Phase 4, section 4) ─────────────────────────────
                Reprinting is a rendering concern, not a new sale: the detail
                row already carries every field `Receipt` needs, so no extra
                query and no reconstructed figures. The same `.print-receipt`
                CSS the live receipt uses hides the rest of the page on print,
                so `window.print()` here prints the slip and nothing else. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => setReprintOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5" />
                Reprint receipt
              </button>
              {/* A voided sale is a record, not a sale: reprinting it would
                  produce a slip that looks collectable. Say so rather than
                  handing over paper that must not be presented. */}
              {detailsVoided && (
                <span className="text-xs text-slate-500">
                  This sale was voided — the copy is for your records only.
                </span>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Reprint preview ────────────────────────────────────────────── */}
      <Modal
        open={reprintOpen && details !== null}
        onClose={() => setReprintOpen(false)}
        title="Reprint receipt"
        description={
          details?.status === 'Voided'
            ? `Voided sale #${details.id.slice(0, 8)} — printed as a void record`
            : `Sale #${details?.id.slice(0, 8) ?? ''} — reprinted from the stored record`
        }
        className="max-w-2xl"
      >
        {details && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
              {details.status === 'Voided'
                ? 'VOID — this transaction was reversed. No goods were sold and no payment was taken.'
                : details.refundedAmount > 0
                  ? `PARTLY REFUNDED — ${formatMoney(details.refundedAmount, store.format)} of ${formatMoney(details.totalAmount, store.format)} returned. The slip below shows the original sale and the returned items.`
                  : `ORIGINAL SALE — the figures below are the stored record of this transaction, not a recalculation.`}
            </div>

            {/* 80mm preview, matching the printed output exactly. */}
            <div className="flex justify-center overflow-x-auto rounded-lg bg-slate-50 p-3">
              <Receipt
                store={store}
                saleId={details.id}
                timestamp={details.createdAt}
                lines={details.items.map((it) => ({
                  name: it.productName,
                  qty: it.quantity,
                  unitPrice: it.priceAtSale,
                }))}
                subtotal={details.subtotal}
                tax={details.tax}
                total={details.totalAmount}
                discount={details.discountAmount}
                redeemedPoints={details.redeemedPoints}
                redemptionAmount={details.redemptionAmount}
                earnedPoints={details.earnedPoints}
                paymentMethod={details.paymentMethod}
                tendered={details.tendered}
                change={details.change}
                cashierName={details.cashierName}
                customerName={details.customerName}
                taxRate={taxRate}
                refundLines={details.refunds.map((r) => ({
                  name: r.reason,
                  qty: 1,
                  unitPrice: r.amount,
                }))}
                refundTotal={details.refundedAmount}
                originalTotal={details.refunds.length > 0 ? details.totalAmount : null}
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                data-testid="reprint-close"
                onClick={() => setReprintOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                data-testid="reprint-print"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <Printer className="h-4 w-4" />
                Print
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={voidOpen && details !== null}
        onClose={() => {
          if (!voidPending) setVoidOpen(false)
        }}
        title="Void this entire sale"
        description="Reverses the WHOLE sale and puts every unit back on the shelf. Use a refund to return only part of it."
        className="max-w-lg"
      >
        {details && (
          <div className="flex flex-col gap-4">
            {/* Sale summary */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-slate-600">#{details.id.slice(0, 8)}</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {money(details.totalAmount)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {METHOD_LABEL[details.paymentMethod] ?? details.paymentMethod}
                {details.customerName ? ` · ${details.customerName}` : ''}
                {details.cashierName ? ` · ${details.cashierName}` : ''}
              </p>
            </div>

            {/* Phase 3: the consequences, in full, BEFORE a reason is chosen.
                The previous version named only the money and left the cashier
                to work out what happened to the stock and the loyalty points. */}
            <ImpactPanel
              tone="void"
              heading="Voiding this sale will"
              effects={[
                `Return ${voidUnits} unit${voidUnits === 1 ? '' : 's'} to stock.`,
                details.earnedPoints > 0
                  ? `Reverse ${details.earnedPoints} loyalty point${details.earnedPoints === 1 ? '' : 's'} earned.`
                  : 'No loyalty points to reverse.',
                details.redeemedPoints > 0
                  ? `Re-debit ${details.redeemedPoints} redeemed point${details.redeemedPoints === 1 ? '' : 's'}.`
                  : 'No redeemed points to re-debit.',
                'Mark the sale Voided. It stays on record for audit.',
              ]}
              items={details.items.map((it) => ({
                name: it.productName,
                qty: it.quantity,
              }))}
            />

            {/* Method-specific reversal notices. Light-theme tokens throughout:
                the old `bg-amber-500/10 text-amber-300` was a dark-theme class
                left behind, and amber-300 on a near-white panel is unreadable. */}
            {details.paymentMethod === 'CASH' && (
              <p className="flex gap-2 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-700 ring-1 ring-slate-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                Cash handling is manual — reconcile the returned cash yourself.
              </p>
            )}
            {details.paymentMethod === 'CARD' && (
              <p className="flex gap-2 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-700 ring-1 ring-slate-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                Any card-terminal reversal must be completed separately; the till
                cannot do it for you.
              </p>
            )}
            {details.paymentMethod === 'STORE_CREDIT' && (
              <p className="flex gap-2 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-700 ring-1 ring-slate-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                The customer&apos;s outstanding balance will be credited back. If the
                balance cannot absorb the reversal, the void is rejected.
              </p>
            )}

            {/* Reason — preset chips + Other */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">Reason for void</p>
              {!otherMode ? (
                <div className="flex flex-wrap gap-2">
                  {PRESET_REASONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReason(preset)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                        reason === preset
                          ? 'bg-red-600 text-white ring-red-500'
                          : 'text-slate-600 ring-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setOtherMode(true)
                      setReason('')
                    }}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100"
                  >
                    Other…
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the reason…"
                  autoFocus
                  maxLength={200}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                />
              )}
            </div>

            {voidError && (
              <p className="rounded-lg bg-red-500/10 p-2.5 text-sm text-red-600 ring-1 ring-red-500/30">{voidError}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidOpen(false)}
                disabled={voidPending}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitVoid}
                disabled={voidPending || !trimmedReason}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {voidPending ? 'Voiding…' : 'Confirm void'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Refund modal (Phase 1d) ──────────────────────────────────────── */}
      <Modal
        open={refundOpen && details !== null}
        onClose={() => {
          if (!refundPending) setRefundOpen(false)
        }}
        title="Refund part of this sale"
        description={`Sale #${details?.id.slice(0, 8) ?? ''} · return only the units you pick and refund just those`}
        className="max-w-lg"
      >
        {details && (
          <div className="flex flex-col gap-4">
            {/* Already-refunded context, so a repeat refund is never a surprise.
                Light-theme tokens: the old `bg-amber-500/10 text-amber-300` was
                a dark-theme class left behind and is unreadable on white. */}
            {details.refundedAmount > 0 && (
              <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
                <p className="font-semibold">Partly refunded already</p>
                <p className="mt-0.5">
                  {money(details.refundedAmount)} of {money(details.totalAmount)} returned.{' '}
                  <span className="font-semibold">
                    {money(details.totalAmount - details.refundedAmount)}
                  </span>{' '}
                  remains returnable.
                </p>
                {details.refunds.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 border-t border-amber-200 pt-1.5">
                    {details.refunds.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {r.reason}
                          {r.cashierName ? ` · ${r.cashierName}` : ''}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          −{money(r.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Phase 3: the consequence, stated before any quantity is staged,
                so the cashier knows what a refund does to the shelf and the
                points balance before they pick the lines. */}
            <ImpactPanel
              tone="refund"
              heading="This refund will"
              effects={[
                refundStagedUnits > 0
                  ? `Return ${refundStagedUnits} unit${refundStagedUnits === 1 ? '' : 's'} to stock.`
                  : 'Return units to stock once you choose a quantity.',
                `Refund ${money(refundPreview)} to the customer.`,
                'Keep the rest of the sale and its loyalty points intact.',
              ]}
              items={refundableItems.map((it) => ({
                name: it.productName,
                qty: stagedFor(it.id, it.quantity - it.refundedQuantity),
                note: `of ${it.quantity - it.refundedQuantity}`,
              }))}
            />

            {/* Per-line quantity picker. `max` is derived from the server's own
                `refundedQuantity`, so a line can never be over-selected here. */}
            <div className="rounded-xl border border-slate-200">
              <ul className="divide-y divide-slate-200">
                {refundableItems.map((it) => {
                  const max = it.quantity - it.refundedQuantity
                  const staged = stagedFor(it.id, max)
                  return (
                    <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-700">{it.productName}</p>
                        <p className="text-xs text-slate-500">
                          {money(it.priceAtSale)} each · {max} returnable
                          {it.refundedQuantity > 0 ? ` · ${it.refundedQuantity} already returned` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Return one fewer ${it.productName}`}
                          disabled={refundPending || staged === 0}
                          onClick={() =>
                            setRefundQty((q) => ({ ...q, [it.id]: Math.max(0, staged - 1) }))
                          }
                          className="h-8 w-8 rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          −
                        </button>
                        <span
                          className="w-8 text-center text-sm font-semibold tabular-nums text-slate-900"
                          data-testid={`refund-qty-${it.id}`}
                        >
                          {staged}
                        </span>
                        <button
                          type="button"
                          aria-label={`Return one more ${it.productName}`}
                          disabled={refundPending || staged >= max}
                          onClick={() =>
                            setRefundQty((q) => ({ ...q, [it.id]: Math.min(max, staged + 1) }))
                          }
                          className="h-8 w-8 rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* Live refund value, computed with the same rules the server uses. */}
            <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <span className="text-sm font-medium text-amber-800">Refund amount</span>
              <span
                className="text-xl font-bold tabular-nums text-amber-900"
                data-testid="refund-amount"
              >
                {money(refundPreview)}
              </span>
            </div>

            {details.paymentMethod === 'CASH' && (
              <p className="flex gap-2 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-700 ring-1 ring-slate-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                Stock and loyalty points reverse automatically. Handing the cash back is
                manual — reconcile the drawer yourself.
              </p>
            )}

            {/* Reason — preset chips + Other. Mandatory: money-out needs a trail. */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-700">Reason for refund</p>
              {!refundOtherMode ? (
                <div className="flex flex-wrap gap-2">
                  {REFUND_REASONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setRefundReason(preset)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                        refundReason === preset
                          ? 'bg-amber-500 text-white ring-amber-400'
                          : 'text-slate-600 ring-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setRefundOtherMode(true)
                      setRefundReason('')
                    }}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100"
                  >
                    Other…
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Describe the reason…"
                  autoFocus
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/25"
                />
              )}
            </div>

            {refundError && (
              <p className="rounded-lg bg-red-500/10 p-2.5 text-sm text-red-600 ring-1 ring-red-500/30">
                {refundError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefundOpen(false)}
                disabled={refundPending}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRefund}
                disabled={refundPending || refundPreview <= 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refundPending ? 'Processing…' : `Refund ${money(refundPreview)}`}
              </button>
            </div>
          </div>
        )}
      </Modal>

    </>
  )
}
