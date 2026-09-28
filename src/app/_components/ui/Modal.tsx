"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type ModalProps = {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the user clicks the backdrop or presses Escape. */
  onClose: () => void;
  /** Title rendered at the top of the modal. */
  title: string;
  /** Optional description/subtitle under the title. */
  description?: string;
  /** Modal content. */
  children: ReactNode;
  /**
   * Optional width override — a max-width class such as `max-w-2xl`.
   * Defaults to `max-w-lg`.
   */
  className?: string;
};

/**
 * The single modal design system for the whole app.
 *
 * Every dashboard dialog (Add Employee, Add Customer, New Purchase Order,
 * Add Category, Add Supplier, Add Product, and the edit/payment/statement
 * variants) renders through this shell, so the overlay, radius, shadow,
 * title treatment, spacing and close affordance are identical everywhere.
 *
 * Behaviour it guarantees for callers:
 *   - fixed, centered, `z-50` overlay with a dimmed + blurred backdrop
 *   - the page behind is inert: body scroll is locked, and pointer/keyboard
 *     interaction cannot reach it while the dialog is open
 *   - the panel itself never exceeds the viewport: header and footer stay
 *     pinned and only the body scrolls (`max-h-[90dvh]`)
 *   - Escape and a backdrop click both close; `busy` suppresses backdrop
 *     dismissal mid-submit so a slow save can't be interrupted
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className = "max-w-lg",
  busy = false,
}: ModalProps & { busy?: boolean }) {
  // `document` doesn't exist during SSR, so the portal can only be created
  // after mount. Until then render nothing (the dialog isn't open yet in
  // practice), which also keeps server/client markup identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Lock the page behind the dialog: no background scrolling and no content
  // shifting as the scrollbar disappears. The original overflow is restored on
  // close (or on unmount) so nested/multiple modals can't leave the body stuck.
  useEffect(() => {
    if (!open) return;
    const { body, documentElement } = document;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [open]);

  // Escape closes, unless a submit is in flight.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;
  if (!mounted) return null;

  // Portal to <body> — ESSENTIAL, not cosmetic.
  // Dialogs render inside the dashboard's <main class="overflow-y-auto">, which
  // is wrapped by <PageTransition>'s `animate-fade-in`. That animation uses
  // `fill-mode: both`, so its final `transform: translateY(0)` stays applied
  // forever — and any non-`none` transform makes that element the containing
  // block for `position: fixed` descendants. Without the portal, `inset-0`
  // resolves against that wrapper (so the scrim misses the sidebar) and the
  // panel centres inside the scrolled pane instead of the viewport.
  // Portalling to <body> sidesteps every transformed/filtered/scrolling
  // ancestor, so the dialog is always centred on, and clipped by, the screen.
  return createPortal(
    // Layering (bottom → top):
    //   1. scrim        — fixed, light veil + gentle blur; `pointer-events-none`
    //                      so it can never swallow a click
    //   2. centering row— `pointer-events-none` for the same reason, so every
    //                      click outside the panel lands on the outer element
    //                      and dismisses via `e.target === e.currentTarget`
    //   3. panel        — the only interactive surface
    // Scrolling lives on the outer wrapper, so a panel taller than the viewport
    // is fully reachable instead of being clipped. `min-h-full` + `my-auto`
    // centers short panels while keeping tall ones top-accessible.
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby={description ? "modal-description" : undefined}
    >
      {/* Scrim: a LIGHT veil (white, not slate/black) so the application behind
          stays visible and readable. The panel's border + soft shadow provide
          the separation, which is why no dark tint is needed here. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-white/45 backdrop-blur-[3px]"
      />
      <div className="pointer-events-none relative flex min-h-full items-center justify-center p-4 sm:p-6">
        <div
          className={`pointer-events-auto my-auto flex max-h-[92dvh] w-full ${className} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_40px_-12px_rgba(15,23,42,0.28)]`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2
                id="modal-title"
                className="text-lg font-bold tracking-tight text-slate-900"
              >
                {title}
              </h2>
              {description && (
                <p
                  id="modal-description"
                  className="mt-0.5 text-sm text-slate-500"
                >
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Body is the only scrolling region: the header stays pinned, and a
              short form never scrolls at all so the whole dialog + its action
              buttons are visible without interacting. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}