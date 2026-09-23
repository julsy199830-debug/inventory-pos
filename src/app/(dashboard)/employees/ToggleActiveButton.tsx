'use client'

import { useState } from 'react'
import { toggleEmployeeStatus } from './actions'
import { toast } from 'sonner'

/**
 * Per-row toggle for an employee's `active` bit. Soft-deletes a cashier
 * (active=false) to revoke login while keeping their `Sale`/`Shift` audit
 * trail â€” see the `User.active` schema comment and the `toggleEmployeeStatus`
 * action doc.
 *
 * The next state travels as a hidden `active` field ("true"/"false") so the
 * action is idempotent to current state (it always sets the requested value
 * rather than blindly flipping). Invoked via an onClick handler that awaits
 * the Server Action, then shows a toast on error. The confirm gate is client-only
 * since it needs `window.confirm`.
 */
export default function ToggleActiveButton({
  id,
  active,
  name,
}: {
  id: string
  active: boolean
  /** Optional display name for the confirm prompt. */
  name?: string
}) {
  const label = name ?? id
  const [pending, setPending] = useState(false)

  async function onClick() {
    // Deactivating is the destructive direction (revokes login), so we confirm it;
    // reactivating is trivial and needs no prompt.
    if (active && !window.confirm(`Deactivate "${label}"? They will be signed out and cannot log in until reactivated. Their sales and shift history are kept.`)) {
      return
    }

    setPending(true)

    try {
      const formData = new FormData()
      formData.append('id', id)
      formData.append('active', active ? 'false' : 'true')
      const res = await toggleEmployeeStatus(formData)

      if (!res.ok) {
        toast.error(res.error ?? 'Failed to update status')
      } else {
        toast.success(active ? 'Employee deactivated' : 'Employee activated')
      }
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={active ? `Deactivate ${label}` : `Activate ${label}`}
      className={[
        'inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        active
          ? 'bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/20'
          : 'bg-slate-800 text-slate-500 hover:bg-slate-800',
      ].join(' ')}
    >
      {active ? 'Active' : 'Inactive'}
    </button>
  )
}
