'use client'

import { useState } from 'react'
import { correctShiftTime } from './actions'
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
 * Per-shift "correct a punch" dialog (Phase 5 — DTR).
 *
 * A manager picks which recorded time to repair (clock-in or clock-out), the
 * replacement value, and — the part that matters — a reason. The reason is
 * `required` on the input as a first line, but the real enforcement is in the
 * Server Action (`correctShiftTime`), which rejects a short/missing reason
 * before touching any row: this dialog is a convenience, not the gate.
 *
 * Mirrors `employees/EditEmployeeDialog`: `useState` open gate, direct action
 * call from the submit handler, pending + inline error, closed on success (the
 * revalidated page then shows the corrected value and the new correction row).
 *
 * The `datetime-local` input needs "YYYY-MM-DDTHH:MM" — not ISO with seconds
 * and a `Z` — so the initial value is formatted in the BROWSER's local zone.
 * Server-sent ISO strings would shift by the UTC offset otherwise, silently
 * recording a different time than the one the manager saw on screen.
 */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type CorrectableShift = {
  id: string
  employeeName: string
  start: string | null
  end: string | null
}

export default function CorrectionDialog({ shift }: { shift: CorrectableShift }) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<'start' | 'end'>('start')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = field === 'start' ? shift.start : shift.end

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    formData.append('shiftId', shift.id)
    formData.append('field', field)
    try {
      const res = await correctShiftTime(formData)
      if (res.ok) setOpen(false)
      else setError(res.error ?? 'Something went wrong')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
      >
        Correct
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Correct time punch"
        description={`Attendance record for ${shift.employeeName}. Every correction is logged with its reason.`}
        busy={pending}
        className="max-w-md"
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Which punch?" htmlFor="correction-field">
            <select
              id="correction-field"
              value={field}
              onChange={(e) => setField(e.target.value === 'end' ? 'end' : 'start')}
              disabled={pending}
              className={selectCls}
            >
              <option value="start">Clock in (start)</option>
              <option value="end">Clock out (end)</option>
            </select>
          </Field>

          <Field
            label={`New ${field === 'start' ? 'clock-in' : 'clock-out'} time`}
            htmlFor="correction-value"
            required
            hint={
              current
                ? `Currently recorded: ${new Date(current).toLocaleString()}`
                : field === 'start'
                  ? 'Currently recorded: not set'
                  : 'Currently recorded: still open (shift not clocked out)'
            }
          >
            <input
              id="correction-value"
              key={`${shift.id}-${field}`}
              name="value"
              type="datetime-local"
              required
              disabled={pending}
              defaultValue={toLocalInputValue(current)}
              className={inputCls}
            />
          </Field>

          <Field
            label="Reason"
            htmlFor="correction-reason"
            required
            hint="At least 4 characters — kept on the record with your name."
          >
            <textarea
              id="correction-reason"
              name="reason"
              required
              minLength={4}
              rows={2}
              disabled={pending}
              placeholder="e.g. Forgot to clock in — arrived 8:55am"
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
              {pending ? 'Saving…' : 'Save correction'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
