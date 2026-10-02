'use client'

import { useState } from 'react'
import { clockIn, clockOut, startBreak, endBreak } from '@/app/(dashboard)/employees/actions'

/**
 * Clock + break controls for `/my-activity` (Phase 5 — DTR).
 *
 * One island driving all four punches against the SAME open shift:
 * clock in/out (with the open-break guard inside `clockOut`) and break
 * start/end. State is derived server-side by the page and passed down; after
 * each action the revalidated page re-renders with fresh flags, so the button
 * set is always a pure function of the persisted state — no optimistic
 * toggling that could drift from reality.
 *
 * The action contracts it leans on:
 *   - `startBreak` rejects when no shift is open or a break is already open;
 *   - `endBreak` is an idempotent no-op when nothing is open;
 *   - `clockOut` refuses while a break is open (naming the reason).
 */
export default function ActivityControls({
  userId,
  clockedIn,
  onBreak,
}: {
  userId: string
  clockedIn: boolean
  onBreak: boolean
}) {
  const [pending, setPending] = useState<'in' | 'out' | 'break-in' | 'break-out' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: typeof pending, action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setPending(kind)
    setError(null)
    const formData = new FormData()
    formData.append('userId', userId)
    try {
      const res = await action(formData)
      if (!res.ok) setError(res.error ?? 'Something went wrong')
    } finally {
      setPending(null)
    }
  }

  const base =
    'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'
  const primary = 'bg-indigo-600 text-white hover:bg-indigo-500'
  const warn = 'bg-amber-50 text-amber-700 hover:bg-amber-100'
  const ghost = 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-2">
        {!clockedIn ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => run('in', clockIn)}
            className={`${base} ${primary}`}
          >
            {pending === 'in' ? 'Clocking in…' : 'Clock In'}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => run('out', clockOut)}
              className={`${base} ${primary}`}
            >
              {pending === 'out' ? 'Clocking out…' : 'Clock Out'}
            </button>
            {!onBreak ? (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => run('break-in', startBreak)}
                className={`${base} ${warn}`}
              >
                {pending === 'break-in' ? 'Starting…' : 'Start Break'}
              </button>
            ) : (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => run('break-out', endBreak)}
                className={`${base} ${ghost}`}
              >
                {pending === 'break-out' ? 'Ending…' : 'End Break'}
              </button>
            )}
          </>
        )}
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
