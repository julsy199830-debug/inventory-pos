'use client'

import { useState } from 'react'
import { clockIn, clockOut, startBreak, endBreak } from './actions'

/**
 * Per-row punch control for an employee's shift (Phase 5 — DTR).
 *
 * Renders whichever actions apply to the employee's current state:
 *   - off the clock  → "Clock In"
 *   - on the clock, no break  → "Clock Out" + "Start Break"
 *   - on an open break → "End Break" (and Clock Out stays visible but the
 *     server rejects it while the break is open, so the control shows the
 *     reason inline rather than letting the click fail silently)
 *
 * The row's `userId` travels as a hidden field so the action can resolve
 * their open shift server-side (and, on clock-in, auto-close any forgotten
 * prior shift — see `clockIn` in `actions.ts`).
 *
 * All four actions return a `ShiftResult`, so we drive them from click
 * handlers with pending/error state rather than a plain `<form action=...>`.
 * A failure shows inline under the buttons; the revalidated page swaps the
 * control's mode on its own, so no local success state is needed.
 */
export default function ClockButton({
  userId,
  clockedIn,
  onBreak = false,
}: {
  userId: string
  /** Whether this employee currently has an open (`end IS NULL`) shift. */
  clockedIn: boolean
  /** Phase 5: whether they have an open (`end IS NULL`) break. */
  onBreak?: boolean
}) {
  const [pending, setPending] = useState<'in' | 'out' | 'break-in' | 'break-out' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handle(kind: 'in' | 'out' | 'break-in' | 'break-out') {
    setPending(kind)
    setError(null)
    const formData = new FormData()
    formData.append('userId', userId)
    try {
      const action =
        kind === 'in'
          ? clockIn
          : kind === 'out'
            ? clockOut
            : kind === 'break-in'
              ? startBreak
              : endBreak
      const res = await action(formData)
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong')
      }
    } finally {
      // Always clear pending — if an action rejects (e.g. a thrown
      // Server Action) the buttons would stay stuck disabled otherwise.
      setPending(null)
    }
  }

  const base =
    'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => handle(clockedIn ? 'out' : 'in')}
          disabled={pending !== null}
          className={[
            base,
            clockedIn
              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'bg-indigo-600 text-white hover:bg-indigo-500',
          ].join(' ')}
        >
          {pending === 'in'
            ? 'Clocking in…'
            : pending === 'out'
              ? 'Clocking out…'
              : clockedIn
                ? 'Clock Out'
                : 'Clock In'}
        </button>

        {clockedIn &&
          (!onBreak ? (
            <button
              type="button"
              onClick={() => handle('break-in')}
              disabled={pending !== null}
              className={`${base} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}
            >
              {pending === 'break-in' ? 'Starting…' : 'Break'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handle('break-out')}
              disabled={pending !== null}
              className={`${base} bg-amber-100 text-amber-800 hover:bg-amber-200`}
            >
              {pending === 'break-out' ? 'Ending…' : 'End Break'}
            </button>
          ))}
      </div>
      {onBreak && (
        <span className="text-[11px] font-medium text-amber-700">On break</span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
