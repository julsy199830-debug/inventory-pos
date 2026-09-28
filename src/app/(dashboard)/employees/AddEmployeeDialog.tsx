'use client'

import { useState } from 'react'
import { createEmployee } from './actions'
import { Modal } from '@/app/_components/ui/Modal'
import {
  Field,
  FormError,
  dialogPrimaryCls,
  dialogSecondaryCls,
  inputCls,
  selectCls,
} from '@/app/_components/ui/Field'

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
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Add Employee
      </button>

      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Add Employee"
          description="Create a staff account for the register or dashboard."
          busy={pending}
        >
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Name" htmlFor="name" required>
              <input
                id="name"
                name="name"
                required
                disabled={pending}
                className={inputCls}
              />
            </Field>
            <Field label="Email" htmlFor="email" required>
              <input
                id="email"
                name="email"
                type="email"
                required
                disabled={pending}
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="PIN" htmlFor="pin" required>
                <input
                  id="pin"
                  name="pin"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  required
                  maxLength={6}
                  placeholder="4–6 digits"
                  disabled={pending}
                  className={inputCls}
                />
              </Field>
              <Field label="Role" htmlFor="role" required>
                <select
                  id="role"
                  name="role"
                  defaultValue="CASHIER"
                  disabled={pending}
                  className={selectCls}
                >
                  <option value="ADMIN">Admin</option>
                  <option value="MANAGER">Manager</option>
                  <option value="CASHIER">Cashier</option>
                </select>
              </Field>
            </div>
            <Field label="Password (optional)" htmlFor="password">
              <input
                id="password"
                name="password"
                type="password"
                disabled={pending}
                className={inputCls}
              />
            </Field>

            <FormError>{error}</FormError>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className={dialogSecondaryCls}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className={dialogPrimaryCls}
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
