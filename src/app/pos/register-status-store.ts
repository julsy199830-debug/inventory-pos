'use client'

import { useSyncExternalStore } from 'react'
import type { RegisterStatus } from './pos-actions'

/**
 * The single in-memory copy of the till's shift state, shared between the
 * status strip and the register header (Phase 7, Section 3 step 2).
 *
 * Why this exists: the header must state whether the operator is on shift, and
 * the strip one line below already reads exactly that from `getRegisterStatus`.
 * Letting the header fetch its own copy would create a SECOND shift state that
 * could disagree with the strip - two panels showing contradictory facts about
 * the same shift is precisely the failure mode the brief forbids. Polling the
 * server from the header would also break the strip's documented "no polling of
 * the server" rule.
 *
 * So: the strip stays the ONLY reader and writer. Every snapshot it reads it
 * publishes here, and every component that wants the state subscribes through
 * `useRegisterStatus`. One fetch, one truth.
 *
 * Server-side this is always `null`: publishing only ever happens from the
 * strip's client effects, and the server snapshot below pins SSR and the
 * hydration render to the same value, so no hydration mismatch is possible.
 */

/** The most recent snapshot published by the strip. `null` = not yet read. */
let status: RegisterStatus | null = null

const listeners = new Set<() => void>()

/**
 * Called by the strip with each snapshot it reads (and `null` when the till
 * unmounts, so a later visit cannot flash a previous operator's state).
 * The ONLY writer - do not publish from anywhere else.
 */
export function publishRegisterStatus(next: RegisterStatus | null): void {
  status = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function clientSnapshot(): RegisterStatus | null {
  return status
}

function serverSnapshot(): RegisterStatus | null {
  return null
}

/**
 * The shift state published by the status strip. `null` until the strip's
 * first read resolves - render a loading/absent state rather than assuming a
 * shift that has not been confirmed.
 */
export function useRegisterStatus(): RegisterStatus | null {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
}
