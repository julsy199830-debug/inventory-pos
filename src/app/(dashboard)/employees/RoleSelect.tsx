'use client'

import { useState } from 'react'
import { assignRole } from './actions'
import { toast } from 'sonner'

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
 * and submits via an onChange handler that awaits the Server Action, then
 * shows a toast on error. The revalidated page reconciles the authoritative
 * value next render.
 */
export default function RoleSelect({
  id,
  role,
}: {
  id: string
  role: Role
}) {
  const [value, setValue] = useState<Role>(role)
  const [pending, setPending] = useState(false)

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as Role
    if (newRole === value) return

    setValue(newRole)
    setPending(true)

    try {
      const formData = new FormData()
      formData.append('id', id)
      formData.append('role', newRole)
      const res = await assignRole(formData)

      if (!res.ok) {
        // Revert optimistic update on error
        setValue(role)
        toast.error(res.error ?? 'Failed to update role')
      } else {
        toast.success('Role updated')
      }
    } catch {
      setValue(role)
      toast.error('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <select
      name="role"
      value={value}
      onChange={onChange}
      disabled={pending}
      className="rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-2 py-1.5 text-xs text-slate-100 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <option value="ADMIN">Admin</option>
      <option value="MANAGER">Manager</option>
      <option value="CASHIER">Cashier</option>
    </select>
  )
}
