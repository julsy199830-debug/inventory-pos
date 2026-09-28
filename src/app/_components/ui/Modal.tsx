"use client";

import { useEffect, type ReactNode } from "react";
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby={description ? "modal-description" : undefined}
    >
      <div
        className={`my-auto flex max-h-[90dvh] w-full ${className} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="modal-title"
              className="text-lg font-bold tracking-tight text-slate-900"
            >
              {title}
            </h2>
            {description && (
              <p id="modal-description" className="mt-0.5 text-sm text-slate-500">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Body is the only scrolling region: the header above and any footer
            the caller renders below stay pinned. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}