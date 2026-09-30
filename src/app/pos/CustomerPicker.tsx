'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, Search, UserRound, X } from 'lucide-react'
import type { PosCustomer } from './PosCheckout'
import { rankCustomerMatches, relativeSince, shouldOfferCreate } from './customer-search'

/**
 * Customer selector for the register (Phase 4).
 *
 * Replaces a plain `<select>` that listed every customer and showed only a
 * points count. On a real customer book that control was unusable: it could
 * not be searched, the phone number a customer says out loud was invisible,
 * and there was no way to tell a regular from a one-off without a second tab.
 *
 * What it does:
 *
 *  - Filters as you type across name and phone, case-insensitively, with a
 *    hard result cap so a common name cannot push the list past the fold.
 *  - Full keyboard control: arrows move, Enter picks, Escape closes and returns
 *    focus to the trigger, Tab leaves. F4 still opens it.
 *  - Shows the three numbers a cashier actually decides on - points, what they
 *    owe, and how near their credit limit they are - all read straight off the
 *    row. No points or balance is recalculated here; `PosCheckout` still owns
 *    the credit-limit check and `lib/loyalty.ts` the redemption ceiling.
 *  - Offers "create this customer" inline when there is no match, but ONLY to
 *    staff. `createCustomer` is gated to ADMIN/MANAGER server-side, and
 *    `canCreate` mirrors that gate so a cashier is never shown a control whose
 *    action will reject them.
 */

export default function CustomerPicker({
  customers,
  value,
  onChange,
  currencySymbol,
  canCreate,
  onCreate,
  creating,
  createError,
}: {
  customers: PosCustomer[]
  /** Currently attached customer id, or '' for a walk-in. */
  value: string
  onChange: (id: string) => void
  currencySymbol: string
  /** Mirrors the server's ADMIN/MANAGER gate on `createCustomer`. */
  canCreate: boolean
  /** Runs the existing `createCustomer` server action. */
  onCreate: (input: { name: string; phone?: string | null }) => Promise<void>
  creating: boolean
  createError: string | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newName, setNewName] = useState('')

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = customers.find((c) => c.id === value) ?? null
  const matches = useMemo(
    () => rankCustomerMatches(customers, query),
    [customers, query],
  )

  // Whether "create <typed>" is a real suggestion: there is no exact match and
  // something has actually been typed.
  const canOfferCreate =
    !creatingNew && shouldOfferCreate(customers, query, canCreate)

  // Close on an outside click. `mousedown` rather than `click` so the click that
  // opens the popover does not immediately close it again.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setCreatingNew(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Opening focuses the search box so the cashier can type straight away.
  //
  // Only the focus move lives here. The highlighted-row reset belongs to the
  // handlers that open the popover: resetting state from an effect renders the
  // result list a second time for no benefit, and the React Compiler rules
  // reject it outright.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  /** Open or close the popover, resetting the highlight and any query. */
  const toggle = () => {
    setActive(0)
    setCreatingNew(false)
    setOpen((v) => !v)
  }

  const close = () => {
    setOpen(false)
    setCreatingNew(false)
    setQuery('')
  }

  const pick = (id: string) => {
    onChange(id)
    close()
  }

  const submitNew = async () => {
    const name = newName.trim()
    if (!name || creating) return
    setCreatingNew(true)
    try {
      await onCreate({ name, phone: null })
    } finally {
      setCreatingNew(false)
    }
  }

  /** The row the list will scroll to, counting the inline-create entry. */
  const totalRows = matches.length + (canOfferCreate ? 1 : 0)

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((i) => (totalRows === 0 ? 0 : (i + 1) % totalRows))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((i) => (totalRows === 0 ? 0 : (i - 1 + totalRows) % totalRows))
        break
      case 'Enter': {
        event.preventDefault()
        if (canOfferCreate && active === matches.length) {
          setNewName(query.trim())
          setCreatingNew(true)
          return
        }
        const match = matches[active]
        if (match) pick(match.id)
        break
      }
      case 'Escape':
        event.preventDefault()
        close()
        break
      default:
        break
    }
  }

  return (
    <div className="border-b border-slate-200 px-5 py-3" ref={rootRef}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label
          htmlFor="customer-trigger"
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Customer
        </label>
        <span className="flex items-center gap-1 text-[11px] text-slate-400">
          <kbd className="rounded border border-slate-300 bg-slate-50 px-1 py-0.5 font-sans font-semibold">
            F4
          </kbd>
        </span>
      </div>

      {/* Trigger: the selected customer's summary, or the walk-in prompt. */}
      <button
        type="button"
        id="customer-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-11 w-full items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-left shadow-sm transition hover:border-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
      >
        <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
        {selected ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-900">
              {selected.name}
            </span>
            <span className="ml-auto shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-indigo-700">
              {selected.loyaltyPoints} pts
            </span>
          </span>
        ) : (
          <span className="flex-1 text-sm text-slate-500">Walk-in Customer</span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="relative mt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls="customer-results"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search name or phone…"
              className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('')
                  setActive(0)
                  inputRef.current?.focus()
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Walk-in stays reachable even while filtering: clearing the cart of
              an accidental attachment should not require retyping. */}
          <ul
            id="customer-results"
            role="listbox"
            className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === ''}
                onClick={() => pick('')}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  value === '' ? 'bg-indigo-50 text-indigo-900' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="flex-1">Walk-in Customer</span>
                {value === '' && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
              </button>
            </li>

            {matches.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.id === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(c.id)}
                  className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition ${
                    active === i ? 'bg-slate-50' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">
                      {c.name}
                    </span>
                    {c.phone && (
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                        {c.phone}
                      </span>
                    )}
                    {c.id === value && (
                      <Check className="ml-auto h-4 w-4 shrink-0 text-indigo-600" />
                    )}
                  </span>
                  {/* The three numbers that decide the sale: what they can spend,
                      what they owe, and whether that is close to their limit. */}
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="font-semibold tabular-nums text-indigo-700">
                      {c.loyaltyPoints} pts
                    </span>
                    {c.currentBalance > 0 && (
                      <span
                        className={`tabular-nums ${
                          c.creditLimit > 0 && c.currentBalance >= c.creditLimit
                            ? 'font-semibold text-red-600'
                            : ''
                        }`}
                      >
                        owes {currencySymbol}
                        {c.currentBalance.toFixed(2)}
                        {c.creditLimit > 0 ? ` / ${c.creditLimit.toFixed(0)}` : ''}
                      </span>
                    )}
                    <span className="text-slate-400">
                      {relativeSince(c.lastSaleAt) ??
                        (c.salesCount === 0 ? 'no purchases yet' : '')}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            {matches.length === 0 && !canOfferCreate && (
              <li className="px-3 py-3 text-center text-sm text-slate-500">
                No customer matches “{query}”.
              </li>
            )}

            {canOfferCreate && (
              <li className="border-t border-slate-200">
                {creatingNew ? (
                  <div className="px-3 py-2">
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">
                      New customer name
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void submitNew()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setCreatingNew(false)
                            setActive(0)
                          }
                        }}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                      />
                      <button
                        type="button"
                        disabled={!newName.trim() || creating}
                        onClick={() => void submitNew()}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {creating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        Add
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Uses the existing customer form. Points start at zero.
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onMouseEnter={() => setActive(matches.length)}
                    onClick={() => {
                      setNewName(query.trim())
                      setCreatingNew(true)
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                      active === matches.length ? 'bg-slate-50' : ''
                    }`}
                  >
                    <Plus className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="text-slate-700">
                      Create “{query.trim()}” as a new customer
                    </span>
                  </button>
                )}
              </li>
            )}
          </ul>

          {createError && (
            <p
              role="alert"
              className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
            >
              {createError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
