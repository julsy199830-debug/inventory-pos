'use client'

import { useState } from 'react'
import { updateEmployee } from './actions'

type Employee = {
  id: string
  name: string
  email: string
  role: string
  active: boolean
}

/**
 * Per-row "Edit Employee" dialog. Mirrors `customers/EditCustomerDialog`:
 * `useState` open gate, the Server Action invoked directly from the submit
 * handler, pending + error state shown inline, and the row's `id` appended to
 * the payload as a hidden field (the action reads it via `load(formData, "id")`).
 *
 * PIN and Password are intentionally left blank here: blank means "leave the
 * existing value alone" server-side (see `updateEmployee`'s optional PIN /
 * password handling). Labels make that affordance explicit so a manager doing a
 * name-only edit doesn't fear wiping the PIN.
 */
export default function EditEmployeeDialog({
  employee,
}: {
  employee: Employee
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    formData.append('id', employee.id)
    try {
      const res = await updateEmployee(formData)
      if (res.ok) {
        setOpen(false)
      } else {
        setError(res.error ?? 'Something went wrong')
      }
    } finally {
      // Always clear pending — if the action rejects we'd otherwise leave the
      // submit button disabled forever with no path to retry.
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3 py-1 text-sm font-medium text-slate-200 hover:bg-slate-950"
      >
        Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Edit Employee</h2>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-200">
                  Name
                </label>
                <input
                  name="name"
                  required
                  defaultValue={employee.name}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  required
                  defaultValue={employee.email}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200">
                  PIN{' '}
                  <span className="font-normal text-slate-400">
                    (leave blank to keep current)
                  </span>
                </label>
                <input
                  name="pin"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  maxLength={6}
                  placeholder="4–6 digits"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200">
                  Role
                </label>
                <select
                  name="role"
                  defaultValue={employee.role}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3 py-2 text-sm text-slate-100 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="MANAGER">Manager</option>
                  <option value="CASHIER">Cashier</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200">
                  Password{' '}
                  <span className="font-normal text-slate-400">
                    (leave blank to keep current)
                  </span>
                </label>
                <input
                  name="password"
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3 py-2 text-sm text-slate-100 placeholder-slate-500 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-900 shadow-sm px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-950 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
