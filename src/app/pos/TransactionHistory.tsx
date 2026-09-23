'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Ban, Receipt as ReceiptIcon, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/app/_components/ui/Modal'
import { voidSale } from '@/app/actions/sales'
import { getRecentSales, getSaleDetails } from './history-actions'
import type { HistoryScope, SaleDetailsEntry, SaleHistoryEntry } from './history-types'

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

const PRESET_REASONS = [
  'Customer cancellation',
  'Wrong item',
  'Wrong quantity',
  'Pricing error',
  'Duplicate transaction',
] as const

const money = (n: number) => `₱${n.toFixed(2)}`

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
}

export default function TransactionHistory({ canVoid }: Props) {
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

  // Void flow
  const [voidOpen, setVoidOpen] = useState(false)
  const [otherMode, setOtherMode] = useState(false)
  const [reason, setReason] = useState('')
  const [voidPending, setVoidPending] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  const refreshList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await getRecentSales({ query, scope })
    if (res.ok) setSales(res.data.sales)
    else setError(res.error)
    setLoading(false)
  }, [query, scope])

  // (Re)load the list whenever the panel opens or filters change. Debounced so
  // typing in the search box doesn't fire a server action per keystroke.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(refreshList, query ? 250 : 0)
    return () => clearTimeout(t)
  }, [open, refreshList, query])

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
    setQuery('')
  }

  const trimmedReason = reason.trim()
  const detailsVoided = details != null && details.status !== 'Completed'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-slate-950 hover:text-slate-100"
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
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sale ID, customer, or cashier…"
                autoComplete="off"
                className="h-10 w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              />
            </div>
            <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
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
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-slate-500">Loading transactions…</p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-red-400">{error}</p>
          ) : sales.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No transactions found for this filter.
            </p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-slate-800 overflow-y-auto rounded-xl border border-slate-800">
              {sales.map((s) => {
                const voided = s.status !== 'Completed'
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => openDetails(s.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-800/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-100">
                          <span className="font-mono text-xs text-slate-400">#{s.id.slice(0, 8)}</span>
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
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                            voided
                              ? 'bg-red-500/15 text-red-400 ring-red-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30'
                          }`}
                        >
                          {voided ? 'Voided' : 'Completed'}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-slate-100">
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
          <p className="py-10 text-center text-sm text-red-400">{detailsError}</p>
        ) : details ? (
          <div className="flex flex-col gap-4">
            {/* Meta */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-sm text-slate-300">#{details.id.slice(0, 8)}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(details.createdAt)}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                  detailsVoided
                    ? 'bg-red-500/15 text-red-400 ring-red-500/30'
                    : 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30'
                }`}
              >
                {detailsVoided ? 'Voided' : 'Completed'}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Cashier</dt>
              <dd className="text-right text-slate-200">{details.cashierName ?? '—'}</dd>
              <dt className="text-slate-500">Customer</dt>
              <dd className="text-right text-slate-200">{details.customerName ?? 'Walk-in'}</dd>
              <dt className="text-slate-500">Payment</dt>
              <dd className="text-right text-slate-200">{METHOD_LABEL[details.paymentMethod] ?? details.paymentMethod}</dd>
            </dl>

            {/* Items */}
            <div className="rounded-xl border border-slate-800">
              <ul className="divide-y divide-slate-800">
                {details.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-slate-200">{it.productName}</p>
                      <p className="text-xs text-slate-500">
                        {it.quantity} × {money(it.priceAtSale)}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-slate-100">
                      {money(it.quantity * it.priceAtSale)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Totals */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="text-right tabular-nums text-slate-200">{money(details.subtotal)}</dd>
              <dt className="text-slate-500">Discount</dt>
              <dd className="text-right tabular-nums text-slate-200">−{money(details.discountAmount)}</dd>
              <dt className="text-slate-500">Tax</dt>
              <dd className="text-right tabular-nums text-slate-200">{money(details.tax)}</dd>
              <dt className="border-t border-slate-800 pt-1 font-semibold text-slate-300">Total</dt>
              <dd className="border-t border-slate-800 pt-1 text-right font-semibold tabular-nums text-slate-100">
                {money(details.totalAmount)}
              </dd>
              {details.tendered != null && (
                <>
                  <dt className="text-slate-500">Tendered</dt>
                  <dd className="text-right tabular-nums text-slate-200">{money(details.tendered)}</dd>
                  <dt className="text-slate-500">Change</dt>
                  <dd className="text-right tabular-nums text-slate-200">{money(details.change ?? 0)}</dd>
                </>
              )}
            </dl>

            {/* Void information — only for voided sales */}
            {detailsVoided && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-red-300">
                  <Ban className="h-4 w-4" /> Voided transaction
                </p>
                <p className="mt-1 text-red-200/90">Reason: {details.voidReason ?? '—'}</p>
                <p className="text-red-200/90">
                  Voided {details.voidedAt ? fmtDateTime(details.voidedAt) : '—'}
                  {details.voidedBy ? ` · by user #${details.voidedBy.slice(0, 8)}` : ''}
                </p>
              </div>
            )}

            {/* Void entry point — UI hint only; voidSale() enforces the role. */}
            {canVoid && !detailsVoided && (
              <button
                type="button"
                onClick={openVoid}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              >
                <Ban className="h-4 w-4" /> Void this sale
              </button>
            )}
          </div>
        ) : null}
      </Modal>

      {/* ── Void confirmation modal ─────────────────────────────────────── */}
      <Modal
        open={voidOpen && details !== null}
        onClose={() => {
          if (!voidPending) setVoidOpen(false)
        }}
        title="Void this sale?"
        description="The sale's records will be reversed. This cannot be undone."
        className="max-w-lg"
      >
        {details && (
          <div className="flex flex-col gap-4">
            {/* Sale summary */}
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-300">#{details.id.slice(0, 8)}</span>
                <span className="font-semibold tabular-nums text-slate-100">{money(details.totalAmount)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {METHOD_LABEL[details.paymentMethod] ?? details.paymentMethod}
                {details.customerName ? ` · ${details.customerName}` : ''}
              </p>
            </div>

            {/* Method-specific reversal notices */}
            {details.paymentMethod === 'CASH' && (
              <p className="flex gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-300 ring-1 ring-amber-500/30">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Inventory and loyalty records will be reversed. Cash handling is manual — reconcile the returned cash yourself.
              </p>
            )}
            {details.paymentMethod === 'CARD' && (
              <p className="flex gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-300 ring-1 ring-amber-500/30">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The system will reverse the sale records. Any card-terminal reversal must be completed separately.
              </p>
            )}
            {details.paymentMethod === 'STORE_CREDIT' && (
              <p className="flex gap-2 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-300 ring-1 ring-amber-500/30">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The customer's outstanding balance and loyalty points will be reversed. If the balance can no longer absorb the reversal, the void will be rejected.
              </p>
            )}

            {/* Reason — preset chips + Other */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-200">Reason for void</p>
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
                          : 'text-slate-300 ring-slate-700 hover:bg-slate-800'
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
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-800"
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
                  className="h-10 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                />
              )}
            </div>

            {voidError && (
              <p className="rounded-lg bg-red-500/10 p-2.5 text-sm text-red-400 ring-1 ring-red-500/30">{voidError}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidOpen(false)}
                disabled={voidPending}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
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

    </>
  )
}
