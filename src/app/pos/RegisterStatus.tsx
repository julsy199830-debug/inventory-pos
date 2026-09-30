'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, LogIn, LogOut, Receipt, RotateCcw, XCircle } from 'lucide-react'
import { clockSelfIn, clockSelfOut, getRegisterStatus, type RegisterStatus } from './pos-actions'

/**
 * Register status strip for the till (Phase 4, section 3).
 *
 * Answers the three questions a cashier has at the start and end of every
 * shift, without leaving the register:
 *
 *   1. Am I on the clock?            -> the pill, and a way to clock in/out.
 *   2. What have I taken so far?     -> live sales count and total.
 *   3. Does the drawer match?        -> per-payment breakdown, refunds, voids.
 *
 * The figures are read server-side by `getRegisterStatus`, which uses the same
 * window and the same "Completed" filter as the snapshot written at clock-out.
 * Nothing here recomputes a total, and nothing here is a payroll figure: this
 * is takings, not earnings.
 *
 * Collapsed by default so it costs one line of vertical space on a busy
 * counter, and expands on demand. The summary it shows is the same data either
 * way, so collapsing hides detail rather than information.
 */

/** "1h 20m" / "45m" - how long the shift has been running. */
function elapsedSince(iso: string | null, now: number): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  STORE_CREDIT: 'Store credit',
}

export default function RegisterStatusBar({
  cashierName,
  currencySymbol,
  refreshKey,
}: {
  cashierName: string
  currencySymbol: string
  /**
   * Bumped by the register whenever a sale, refund or void completes.
   *
   * The live takings are a SERVER read, so they cannot update from local state.
   * Without this the figure a cashier reconciles the drawer against would sit
   * frozen at whatever it was when the till loaded - which is worse than
   * showing nothing at all, because it looks authoritative.
   */
  refreshKey: number
}) {
  const [status, setStatus] = useState<RegisterStatus | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState<{
    totalSales: number
    salesCount: number
    endedAt: string | null
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const money = useCallback(
    (n: number) => `${currencySymbol}${n.toFixed(2)}`,
    [currencySymbol],
  )

  const refresh = useCallback(async () => {
    const res = await getRegisterStatus()
    if (res.ok) setStatus(res.data)
    else setError(res.error)
  }, [])

  // Load once on mount, then keep the elapsed clock ticking only while a shift
  // is open. No polling of the server: the figures move when the cashier acts
  // (a sale, a refund), and those paths already re-render this panel.
  //
  // The fetch is scheduled rather than called inline - the same shape
  // `TransactionHistory` uses for its first load. It keeps the network call off
  // the synchronous effect path, and it is how the "set state in an effect"
  // rule is honoured: the update arrives as the result of a completed request,
  // not as a consequence of the effect having run.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(t)
  }, [refresh])

  // Re-read the takings whenever the register reports activity.
  //
  // Skipped on the first run (refreshKey 0) because the mount effect above
  // already covers that fetch; without the guard the status would be read twice
  // on every page load. Scheduled for the same reason: the state update is the
  // result of a completed request, not a consequence of the effect running.
  useEffect(() => {
    if (refreshKey === 0) return
    const t = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(t)
  }, [refreshKey, refresh])

  useEffect(() => {
    if (!status?.onClock) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [status?.onClock])

  const handleClock = async (closing: boolean) => {
    setBusy(true)
    setError(null)
    try {
      if (closing) {
        const res = await clockSelfOut()
        if (!res.ok) {
          setError(res.error)
          return
        }
        // Show the persisted snapshot, not the live figures: this is what the
        // shift was actually recorded as.
        setClosed({
          totalSales: res.data.totalSales,
          salesCount: res.data.salesCount,
          endedAt: res.data.endedAt,
        })
        setExpanded(true)
      } else {
        const res = await clockSelfIn()
        // The result is checked, not assumed. Ignoring it means a rejected
        // clock-in looks identical to a successful one: the pill simply stays
        // "Off shift" and the cashier has no idea why the button did nothing.
        if (!res.ok) {
          setError(res.error ?? 'Could not start the shift. Please try again.')
          return
        }
      }
      await refresh()
    } catch {
      setError('Could not reach the register. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const live = status?.live ?? null

  return (
    <div
      className="border-b border-slate-200 bg-slate-50 px-4 py-2"
      // `data-register-loaded` flips only once the status request has resolved,
      // so a caller can wait for the strip to be genuinely ready rather than for
      // the shell that paints before hydration and before the fetch lands.
      data-register-loaded={status ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* On/off the clock, and who this till belongs to. */}
        <span
          // `data-on-clock` is the state a test needs without reading the
          // label text, so the assertion survives a wording change.
          data-testid="shift-state"
          data-on-clock={status?.onClock ? 'true' : 'false'}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            status?.onClock
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
              : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
          }`}
        >
          {status?.onClock ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {status?.onClock ? 'On shift' : 'Off shift'}
        </span>

        <span className="truncate text-xs text-slate-600">{cashierName}</span>

        {status?.onClock && live && (
          <>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs tabular-nums text-slate-600">
              {elapsedSince(status.shiftStartedAt, now)}
            </span>
            <span className="text-xs text-slate-400">·</span>
            {/* data-testid so the E2E suite can read the figure a cashier reads,
                rather than scraping the DOM around it. */}
            <span className="text-xs text-slate-700" data-testid="shift-sales">
              <span className="font-semibold tabular-nums">{live.salesCount}</span> sales ·{' '}
              <span className="font-semibold tabular-nums">{money(live.grossSales)}</span>
            </span>
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy || !status}
            // Closing is decided by the CURRENT state, not its negation: the
            // button reads "End shift" precisely when a shift is open, so
            // `status.onClock` IS the closing flag. Negating it made "Start
            // shift" call clockSelfOut, which then rejected with "You are not
            // currently on the clock" and left the till silently off the clock.
            onClick={() => void handleClock(status?.onClock === true)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              status?.onClock
                ? 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100'
                : 'bg-indigo-600 text-white hover:bg-indigo-500'
            }`}
          >
            {status?.onClock ? (
              <>
                <LogOut className="h-3.5 w-3.5" />
                End shift
              </>
            ) : (
              <>
                <LogIn className="h-3.5 w-3.5" />
                Start shift
              </>
            )}
          </button>

          {(live || closed) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              {expanded ? 'Hide' : 'Summary'}
              <ChevronDown
                className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}

      {expanded && closed && (
        <div className="mt-2.5 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-900">Shift closed</p>
          <p className="mt-1 text-xs text-slate-600">
            Recorded <span className="font-semibold tabular-nums">{closed.salesCount}</span>{' '}
            sales totalling{' '}
            <span className="font-semibold tabular-nums">{money(closed.totalSales)}</span>.
          </p>
          <button
            type="button"
            onClick={() => setClosed(null)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
          >
            <RotateCcw className="h-3 w-3" />
            Dismiss
          </button>
        </div>
      )}

      {expanded && live && !closed && (
        <div className="mt-2.5 space-y-2.5 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Taken by payment
            </p>
            <ul className="mt-1.5 space-y-1">
              {live.byPayment.length === 0 && (
                <li className="text-xs text-slate-500">No sales yet this shift.</li>
              )}
              {live.byPayment.map((p) => (
                <li key={p.method} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">
                    {PAYMENT_LABELS[p.method] ?? p.method}
                    <span className="ml-1 text-slate-400">({p.count})</span>
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {money(p.total)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Money and stock moving the OTHER way. A drawer reconciled against
              gross-of-refunds reads short, so these are shown next to the
              takings rather than buried in the history panel. */}
          <div className="grid gap-1.5 border-t border-slate-200 pt-2 sm:grid-cols-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <Receipt className="h-3.5 w-3.5 text-amber-600" />
                Refunds ({live.refundCount})
              </span>
              <span className="font-semibold tabular-nums text-amber-700">
                −{money(live.refundTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <XCircle className="h-3.5 w-3.5 text-red-600" />
                Voids ({live.voidCount})
              </span>
              <span className="font-semibold tabular-nums text-red-700">
                −{money(live.voidTotal)}
              </span>
            </div>
          </div>

          {live.refundCount > 0 && (
            <p className="text-[11px] leading-snug text-slate-500">
              Net taken, after refunds and voids:{' '}
              <span className="font-semibold tabular-nums text-slate-700">
                {money(
                  live.grossSales - live.refundTotal - live.voidTotal,
                )}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}