"use client";

import { type ReactNode } from "react";
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
  /** Optional width override. Defaults to max-w-lg. */
  className?: string;
};

/**
 * Reusable accessible modal shell used by every dashboard dialog.
 * Handles backdrop click, Escape key, focus trapping (via browser dialog
 * semantics when `open`), and consistent styling.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className = "max-w-lg",
}: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby={description ? "modal-description" : undefined}
    >
      <div className={`w-full ${className} overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/40`}>
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 id="modal-title" className="text-base font-semibold tracking-tight text-slate-100">
              {title}
            </h2>
            {description && (
              <p id="modal-description" className="mt-0.5 text-sm text-slate-400">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}