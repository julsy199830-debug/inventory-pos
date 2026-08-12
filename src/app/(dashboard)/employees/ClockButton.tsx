'use client'

import { useState } from 'react'
import { clockIn, clockOut } from './actions'

/**
 * Per-row clock in/out control for an employee's shift.
 *
 * Renders whichever action applies to the employee's current on-the-clock
 * state: a "Clock In" button when they have no open shift, or "Clock Out" when
 * they do. The row's `userId` travels as a hidden field so the action can
 * resolve their open shift server-side (and, on clock-in, auto-close any
 * forgotten prior shift — see `clockIn` in `actions.ts`).
 *
 * Because the actions return a `ShiftResult` (unlike the void form-driven
 * toggles) we drive them from a click handler with `useActionState`-style
 * pending/error state rather than a plain `<form action=...>`. A failure shows
 * inline under the button; the revalidated page swaps the control's mode on its
 * own, so no local success state is needed.
 */
export default function ClockButton({
  userId,
  clockedIn,
}: {
  userId: string
  /** Whether this employee currently has an open (`end IS NULL`) shift. */
  clockedIn: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handle() {
    setPending(true)
    setError(null)
    const formData = new FormData()
    formData.append('userId', userId)
    try {
      const res = clockedIn ? await clockOut(formData) : await clockIn(formData)
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong')
      }
    } finally {
      // Always clear pending — if clockIn/clockOut rejects (e.g. a thrown
      // Server Action) the button would stay stuck disabled otherwise.
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className={[
          'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
          clockedIn
            ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'bg-blue-600 text-white hover:bg-blue-700',
        ].join(' ')}
      >
        {pending
          ? clockedIn
            ? 'Clocking out…'
            : 'Clocking in…'
          : clockedIn
            ? 'Clock Out'
            : 'Clock In'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
