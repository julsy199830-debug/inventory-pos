'use client'

import { toggleEmployeeStatus } from './actions'

/**
 * Per-row toggle for an employee's `active` bit. Soft-deletes a cashier
 * (active=false) to revoke login while keeping their `Sale`/`Shift` audit
 * trail — see the `User.active` schema comment and the `toggleEmployeeStatus`
 * action doc.
 *
 * The next state travels as a hidden `active` field ("true"/"false") so the
 * action is idempotent to current state (it always sets the requested value
 * rather than blindly flipping). Invoked via the `<form action=...>` prop, so
 * it works with progressive enhancement; the confirm gate is client-only since
 * it needs `window.confirm`.
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
  // Deactivating is the destructive direction (revokes login), so we confirm it;
  // reactivating is trivial and needs no prompt.
  const verb = active ? 'Deactivate' : 'Activate'

  return (
    <form
      action={toggleEmployeeStatus}
      onSubmit={(e) => {
        if (
          active &&
          !window.confirm(
            `Deactivate "${label}"? They will be signed out and cannot log in until reactivated. Their sales and shift history are kept.`,
          )
        ) {
          e.preventDefault()
        }
      }}
      className="inline-block"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      <button
        type="submit"
        title={active ? `Deactivate ${label}` : `Activate ${label}`}
        className={[
          'inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          active
            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
        ].join(' ')}
      >
        {active ? 'Active' : 'Inactive'}
      </button>
    </form>
  )
}
