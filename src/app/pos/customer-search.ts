import type { PosCustomer } from './PosCheckout'

/**
 * Pure helpers behind the register's customer picker (Phase 4).
 *
 * These are deliberately free of React and of Prisma so the ordering rules - the
 * part a cashier actually feels - can be pinned by unit tests directly, rather
 * than only through the browser. See `tests/unit/customer-search.test.ts`.
 *
 * Nothing here computes money or points. Every number is read straight off the
 * customer row; `PosCheckout` still owns the credit-limit check and
 * `lib/loyalty.ts` the redemption ceiling.
 */

/** How many matches to show before scrolling. Beyond this the list is noise. */
export const MAX_RESULTS = 8

/**
 * Orders and caps customer matches for the picker.
 *
 * Relevance order:
 *   0. exact phone match  - the number read off a loyalty card
 *   1. name prefix match  - they start typing a surname
 *   2. any other match    - a substring somewhere in the name or phone
 *
 * Ties break on name so the order is stable between keystrokes: without that,
 * the highlighted row could jump mid-search and Enter would attach a different
 * customer than the one the cashier saw highlighted.
 *
 * Phone is matched on digits-only as well as raw, so "0917 123" finds
 * "09171234567" - a phone is typed with spaces far more often than not.
 */
export function rankCustomerMatches(
  customers: PosCustomer[],
  query: string,
  limit: number = MAX_RESULTS,
): PosCustomer[] {
  const q = query.trim().toLowerCase()
  if (!q) return customers.slice(0, limit)

  const digits = q.replace(/\D/g, '')

  const rank = (c: PosCustomer): number => {
    const phone = (c.phone ?? '').toLowerCase()
    const phoneDigits = (c.phone ?? '').replace(/\D/g, '')
    const name = c.name.toLowerCase()

    if (phone && (phone === q || (digits.length > 0 && phoneDigits === digits))) return 0
    if (name.startsWith(q)) return 1
    return 2
  }

  const matches = customers.filter((c) => {
    if (rank(c) < 2) return true
    const name = c.name.toLowerCase()
    const phone = (c.phone ?? '').toLowerCase()
    const phoneDigits = (c.phone ?? '').replace(/\D/g, '')
    return (
      name.includes(q) ||
      phone.includes(q) ||
      (digits.length > 0 && phoneDigits.includes(digits))
    )
  })

  matches.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  return matches.slice(0, limit)
}

/**
 * Coarse "how long ago" label for a customer's most recent purchase.
 *
 * Relative beats a raw date for a glance at the till. Returns null when there
 * is no purchase or the value is unparseable, so callers can choose their own
 * "never" wording rather than being handed a misleading zero.
 */
export function relativeSince(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  // A clock skew that puts the sale in the future should read as "today"
  // rather than as a negative age.
  const days = Math.floor(Math.max(0, now - then) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/**
 * Whether the picker should offer "create this as a new customer".
 *
 * Staff-only by construction - the caller passes `canCreate`, which mirrors the
 * server's ADMIN/MANAGER gate on `createCustomer`, so a cashier is never shown
 * a control whose action would reject them. Also refuses when an exact name
 * match already exists, so the offer never shadows a real customer.
 */
export function shouldOfferCreate(
  customers: PosCustomer[],
  query: string,
  canCreate: boolean,
): boolean {
  if (!canCreate) return false
  const q = query.trim()
  if (q.length < 2) return false
  return !customers.some((c) => c.name.trim().toLowerCase() === q.toLowerCase())
}