'use client'

import { useState } from 'react'
import { assignRole } from './actions'

type Role = 'ADMIN' | 'MANAGER' | 'CASHIER'

/**
 * Inline per-row role `<select>` that posts directly to the `assignRole`
 * Server Action on change.
 *
 * A dedicated control rather than the edit dialog so role changes are a quick
 * one-click op — the action takes just `id` + `role`. `asRole` narrows the
 * submitted value server-side (unknown values fall back to CASHIER), so this
 * client never widens permissions; a tampered select can only *narrows* down to
 * the least-privileged default at worst.
 *
 * Optimistically reflects the chosen value immediately (controlled local state)
 * and submits the tiny form via `<form action=...>` for progressive
 * enhancement; the revalidated page reconciles the authoritative value next
 * render.
 */
export default function RoleSelect({
  id,
  role,
}: {
  id: string
  role: Role
}) {
  const [value, setValue] = useState<Role>(role)

  return (
    <form action={assignRole} className="inline-block">
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        value={value}
        onChange={(e) => {
          setValue(e.target.value as Role)
          // Submit the enclosing form so the Server Action runs. A plain
          // HTMLFormElement.requestSubmit() is available in evergreen browsers;
          // the value the action sees is the hidden-field payload + the select's
          // current value, since the select is also a named form control.
          e.currentTarget.form?.requestSubmit()
        }}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
      >
        <option value="ADMIN">Admin</option>
        <option value="MANAGER">Manager</option>
        <option value="CASHIER">Cashier</option>
      </select>
    </form>
  )
}
