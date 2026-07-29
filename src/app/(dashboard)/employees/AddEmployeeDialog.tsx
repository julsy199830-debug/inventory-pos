'use client'

import { useState } from 'react'
import { createEmployee } from './actions'

/**
 * "Add New Employee" dialog. Same client-island pattern as
 * `customers/AddCustomerDialog`: a `useState` open/close gate, the Server
 * Action invoked from the submit handler (no `useActionState`), pending +
 * error state surfacing the first server-side validation message inline.
 *
 * PIN is a plain text input with `inputMode="numeric"` + the 4–6 digit rule
 * enforced server-side by `PIN_PATTERN` in `actions.ts`. We deliberately do not
 * `type="password"` it: the PIN is a short numeric login handle, not a secret
 * password, and the manager entering it benefits from seeing the value.
 */
export default function AddEmployeeDialog() {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Capture the form before the await — `e.currentTarget` is typed null
    // across an async boundary, so we can't reach it after `await`.
    const form = e.currentTarget
    setPending(true)
    setError(null)
    const formData = new FormData(form)
    try {
      const res = await createEmployee(formData)
      if (res.ok) {
        form.reset()
        setOpen(false)
      } else {
        setError(res.error ?? 'Something went wrong')
      }
    } catch {
      // The action is expected to resolve with { ok:false } on any handled
      // failure, but a thrown Server Action (network drop, serialization error,
      // an unhandled reach past the action's own try/catch) rejects the
      // promise — fall back to a generic message instead of leaving the
      // dialog frozen on "Saving...".
      setError('Something went wrong. Please try again.')
    } finally {
      // ALWAYS clear pending — runs on the success path, the { ok:false }
      // path, AND the thrown path above. Without this, a rejection would
      // skip the previous inline setPending(false) and wedge the Save button.
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Add Employee
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">Add Employee</h2>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Name
                </label>
                <input
                  name="name"
                  required
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  required
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  PIN
                </label>
                <input
                  name="pin"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  required
                  maxLength={6}
                  placeholder="4–6 digits"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Role
                </label>
                <select
                  name="role"
                  defaultValue="CASHIER"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="MANAGER">Manager</option>
                  <option value="CASHIER">Cashier</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Password <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  name="password"
                  type="password"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {pending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
