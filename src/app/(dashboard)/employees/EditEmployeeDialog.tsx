'use client'

import { useState } from 'react'
import { updateEmployee } from './actions'
import { Modal } from '@/app/_components/ui/Modal'
import {
  Field,
  FormError,
  dialogPrimaryCls,
  dialogSecondaryCls,
  inputCls,
  selectCls,
} from '@/app/_components/ui/Field'

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
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white shadow-sm px-3 py-1 text-sm font-medium text-slate-700 hover:bg-white"
      >
        Edit
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit Employee"
        description="Blank PIN or password keeps the current value."
        busy={pending}
        className="max-w-md"
      >
        <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Name" htmlFor="emp-edit-name" required>
                <input
                  id="emp-edit-name"
                  name="name"
                  required
                  disabled={pending}
                  defaultValue={employee.name}
                  className={inputCls}
                />
              </Field>
              <Field label="Email" htmlFor="emp-edit-email" required>
                <input
                  id="emp-edit-email"
                  name="email"
                  type="email"
                  required
                  disabled={pending}
                  defaultValue={employee.email}
                  className={inputCls}
                />
              </Field>
              <Field
                label="PIN"
                htmlFor="emp-edit-pin"
                hint="Leave blank to keep the current PIN. 4–6 digits."
              >
                <input
                  id="emp-edit-pin"
                  name="pin"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  maxLength={6}
                  placeholder="4–6 digits"
                  disabled={pending}
                  className={inputCls}
                />
              </Field>
              <Field label="Role" htmlFor="emp-edit-role" required>
                <select
                  id="emp-edit-role"
                  name="role"
                  disabled={pending}
                  defaultValue={employee.role}
                  className={selectCls}
                >
                  <option value="ADMIN">Admin</option>
                  <option value="MANAGER">Manager</option>
                  <option value="CASHIER">Cashier</option>
                </select>
              </Field>
              <Field
                label="Password"
                htmlFor="emp-edit-password"
                hint="Leave blank to keep the current password."
              >
                <input
                  id="emp-edit-password"
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
    </>
  )
}
