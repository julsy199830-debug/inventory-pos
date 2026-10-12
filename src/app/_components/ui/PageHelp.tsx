"use client";

import { useCallback, useSyncExternalStore, useState } from "react";
import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { Modal } from "./Modal";

/**
 * Phase 7 Step 6 — lightweight, reusable contextual help.
 *
 * One small component answers "what is this page for?" and "what can I do
 * here?" without a manual or a forced tour:
 *
 *   - a compact "What can I do here?" trigger sits with the page title,
 *   - it opens a short panel (purpose → the main tasks → one clear next step),
 *   - the panel is dismissible and reopenable at any time from the trigger.
 *
 * First-use memory lives in `localStorage` (never the database), keyed by
 * `id`: until the visitor opens (or dismisses) the tip once, the trigger
 * carries a small non-blocking "New" dot. Opening or dismissing marks it
 * seen; the trigger always reopens it. No Prisma migration, no server state.
 *
 * The tip NEVER auto-opens: auto-opening would overlay the page on first
 * visit, intercept clicks in the POS (scan → cart → payment) and break
 * pointer-action tests. The nudge is a dot on the trigger, not a dialog.
 *
 * Accessibility & robustness:
 *   - the trigger is a real button with `aria-haspopup="dialog"` and a label,
 *   - the panel is the shared `Modal` (portal, Escape, backdrop, scroll-lock,
 *     `role="dialog"` + `aria-modal`), so it is keyboard- and screen-reader-
 *     safe and can never be clipped by the scrolling dashboard,
 *   - it is fully client-gated: SSR renders the trigger only (closed), so
 *     there is no hydration mismatch and the tip can never block first paint,
 *     product search, the cart, or payment.
 */

export type HelpContent = {
  /** Stable id for first-use memory and the trigger's test id. */
  id: string;
  /** Panel title, e.g. "About Products". */
  title: string;
  /** One plain-language sentence: what this page is for. */
  purpose: string;
  /** The main things a user can do here, as short imperatives. */
  tasks: string[];
  /** One clear next step / primary destination. */
  nextStep?: { label: string; href: string };
  /** Optional closing reassurance, e.g. what an empty list means. */
  note?: string;
};

function seenKey(id: string): string {
  return `pagehelp:seen:${id}`;
}

/**
 * A tiny external store for the "has this tip been acknowledged?" flag.
 *
 * `localStorage` is external mutable state, so React's sanctioned way to read
 * it without an effect (and without a hydration mismatch) is
 * `useSyncExternalStore`. Notifications come from our own writes (via
 * {@link emitSeenChange}) and from other tabs (`storage`), so the snapshot
 * React commits always matches a notified change — never a silent drift.
 */
const seenListeners = new Set<() => void>();

function subscribeSeen(onChange: () => void): () => void {
  seenListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    seenListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function emitSeenChange(): void {
  for (const listener of seenListeners) listener();
}

export function PageHelp({
  content,
  variant = "full",
}: {
  content: HelpContent;
  /**
   * `full` (default) renders a labelled "What can I do here?" trigger for
   * `PageHeader`. `compact` renders an icon-only trigger for the POS toolbar,
   * where a full label would crowd the search field — the dialog content is
   * identical either way.
   */
  variant?: "full" | "compact";
}) {
  // First-use nudge via `useSyncExternalStore`. The server snapshot is `false`
  // (no dot) so SSR and the hydration render agree — no mismatch — and right
  // after mount the client snapshot flips to `true` for a first-time visitor,
  // painting a small "New" dot on the trigger. The dot NEVER opens a dialog
  // by itself, so it cannot intercept clicks or block the POS flow.
  const isUnseen = useSyncExternalStore(
    subscribeSeen,
    () => {
      try {
        return window.localStorage.getItem(seenKey(content.id)) === null;
      } catch {
        // Storage unavailable (private mode): never auto-open, but the
        // trigger below always opens the panel on demand.
        return false;
      }
    },
    () => false,
  );

  // Explicit user intent only. The dialog opens SOLELY from a trigger click
  // (`userOpened`) and closes on Got it / Escape / backdrop / next-step
  // (`userClosed`). There is deliberately no auto-open: see the header note.
  const [userOpened, setUserOpened] = useState(false);
  const [userClosed, setUserClosed] = useState(false);

  const open = userOpened && !userClosed;

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(seenKey(content.id), "1");
    } catch {
      // Ignore: the tip simply re-shows next visit if storage is unavailable.
    }
    emitSeenChange();
  }, [content.id]);

  const dismiss = useCallback(() => {
    setUserClosed(true);
    setUserOpened(false);
    markSeen();
  }, [markSeen]);

  const openManually = useCallback(() => {
    setUserClosed(false);
    setUserOpened(true);
    markSeen();
  }, [markSeen]);

  return (
    <>
      <button
        type="button"
        onClick={openManually}
        aria-haspopup="dialog"
        aria-label={`What can I do here? ${content.title}`}
        data-testid={`page-help-trigger-${content.id}`}
        className={
          variant === "compact"
            ? "relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            : "relative inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        }
      >
        <HelpCircle className={variant === "compact" ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
        {variant === "compact" ? null : "What can I do here?"}
        {isUnseen ? (
          <span
            data-testid={`page-help-new-${content.id}`}
            aria-hidden
            title="New"
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-600"
          />
        ) : null}
      </button>

      <Modal
        open={open}
        onClose={dismiss}
        title={content.title}
        description={content.purpose}
      >
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What you can do
            </h3>
            <ul className="mt-2 space-y-1.5">
              {content.tasks.map((task) => (
                <li key={task} className="flex items-start gap-2 text-sm text-slate-700">
                  <span aria-hidden className="mt-0.5 text-indigo-500">
                    •
                  </span>
                  <span>{task}</span>
                </li>
              ))}
            </ul>
          </div>

          {content.nextStep ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Next step
              </h3>
              <Link
                href={content.nextStep.href}
                onClick={dismiss}
                data-testid="page-help-next-step"
                className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
              >
                {content.nextStep.label}
                <span aria-hidden>→</span>
              </Link>
            </div>
          ) : null}

          {content.note ? (
            <p className="text-sm text-slate-500">{content.note}</p>
          ) : null}

          <div className="flex justify-end border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={dismiss}
              data-testid="page-help-got-it"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Got it
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
