'use client'

import { useEffect, useRef } from 'react'

/**
 * Max gap (ms) between keystrokes still considered part of the same scanner
 * burst. USB/Bluetooth barcode scanners act as keyboard-emulation devices that
 * blast their code out character-by-character at ~10–20ms per key, far faster
 * than a human can type, then send a terminal `Enter`. Any gap wider than this
 * starts a fresh buffer, so a stray keypress never merges with a real scan.
 */
const SCAN_BURST_MS = 100

/**
 * If a partial burst sits idle this long, drop it. Guards against a half-read
 * code lingering when the scanner disconnects mid-scan or the user wanders off.
 */
const BUFFER_TIMEOUT_MS = 500

/**
 * Minimum characters before an Enter-terminated burst is treated as a scan.
 * Prevents an accidental single `Enter` keypress (e.g. pressing the big
 * "Process Payment" button) from being routed to the scanner handler.
 */
const DEFAULT_MIN_LENGTH = 3

/**
 * Global USB/Bluetooth barcode-scanner listener.
 *
 * Registers a single `window` keydown listener that accumulates fast key
 * sequences (the signature of a keyboard-emulation scanner) into a buffer and
 * fires `onScan` with the completed code when the scanner's terminal `Enter`
 * arrives. The listener is mounted once via `useEffect` and always invokes the
 * latest `onScan` through a ref, so the callback can close over fresh cart
 * state without re-registering the listener on every render.
 *
 * Scanner input is ignored whenever focus sits inside a text-editable element
 * (`<input>`, `<textarea>`, `<select>`, contenteditable). Standard POS fields
 * like a customer search must never feed the scanner buffer. The dedicated
 * barcode box on the POS screen is deliberately NOT pumped through this hook —
 * it handles its own Enter key with its own lookup so a focused scan can never
 * double-process (once via buffer, once via the field's value).
 *
 * Returns nothing; the effect is fully self-contained.
 */
export function useBarcodeScanner(
  onScan: (code: string) => void,
  opts?: { minLength?: number },
) {
  // Keep the caller's latest callback without re-binding the listener. The
  // hook lives for the lifetime of the POS screen, so this ref is the only
  // channel that stays fresh across cart updates, modal opens, etc.
  const onScanRef = useRef(onScan)
  // The callback is refreshed inside an effect, not during render — writing
  // `ref.current` while rendering violates the Rules of React (the write can be
  // dropped or double-run by concurrent rendering). The keydown listener stays
  // registered exactly once and reads the freshest callback at event time.
  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  const minLength = opts?.minLength ?? DEFAULT_MIN_LENGTH

  useEffect(() => {
    let buffer = ''
    let lastKeyTime = 0
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const clearIdleTimer = () => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Never read keystrokes inside a text-editable element — those belong to
      // the field. `matches` covers input/textarea/select; contenteditable is
      // the catch-all for custom editors the browser flags as editable.
      const target = e.target as HTMLElement | null
      if (
        target != null &&
        (target.isContentEditable || target.matches('input, textarea, select'))
      ) {
        return
      }

      // Scanner terminal key. Only claim it when there's a buffered burst to
      // deliver — a lone Enter (e.g. activating a focused button) passes
      // through untouched so the UI keeps behaving normally.
      if (e.key === 'Enter') {
        const code = buffer.trim()
        buffer = ''
        clearIdleTimer()
        if (code.length >= minLength) {
          e.preventDefault()
          onScanRef.current(code)
        }
        return
      }

      // Skip modifier combos, IME composition, and multi-char "keys" (Shift,
      // Backspace, F-keys). Scanners emit single printable characters only.
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return

      const now = Date.now()
      // A gap wider than a scanner's burst resets the buffer — a human typing
      // into nothing (or a scanner that stuttered) shouldn't concatenate.
      if (now - lastKeyTime > SCAN_BURST_MS) buffer = ''
      lastKeyTime = now
      buffer += e.key

      // Stale-buffer guard: if no more keys arrive within the window, drop what
      // was accumulated so the next scan starts clean.
      clearIdleTimer()
      idleTimer = setTimeout(() => {
        buffer = ''
        idleTimer = null
      }, BUFFER_TIMEOUT_MS)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearIdleTimer()
    }
  }, [minLength])
}
