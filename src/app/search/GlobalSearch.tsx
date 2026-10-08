"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { globalSearch, type SearchGroups, type SearchHit } from "./actions";
import { GROUP_ORDER } from "./search-meta";
import { GlobalSearchResults } from "./GlobalSearchResults";

/**
 * Phase 7 Step 5 — Global Search / Quick Navigation (client dialog).
 *
 * "Search = find something quickly": one box, plain words, grouped answers.
 * No command-line terminology — groups are labeled Customers / Products /
 * Sales / Purchase Orders / Employees / Pages, each row carries a small
 * icon + type word, and Enter opens the highlighted answer.
 *
 * Keyboard contract:
 *   - Ctrl+K (or Cmd+K) opens from anywhere EXCEPT inside a text field, so
 *     typing in the till, a picker, or a form never hijacks keystrokes. The
 *     POS F-key shortcuts are untouched (different keys, plus the same
 *     typing-target guard they use).
 *   - Escape closes (the input is focused, so the field guard above can't
 *     block the open stroke landing here — open only fires when NOT typing).
 *   - ArrowUp/Down move through a FLAT list of all visible rows (across
 *     groups), Enter navigates to the highlighted href.
 *   - A visible "Ctrl K" hint sits on the trigger button; the dialog also
 *     names the keys in its footer, so nothing is shortcut-mandatory.
 *
 * Data contract: every keystroke is debounced (220ms); queries under 2 chars
 * only filter the in-memory page list (no DB reads); the server action caps
 * each type at 5 rows. Results render from the last completed request only
 * (request id guard), so a slow reply can't overwrite fresher answers.
 */

const DEBOUNCE_MS = 220;

/** True when keystrokes belong to a field — never steal those for shortcuts. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
  );
}

type Status = "idle" | "loading" | "error";

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroups | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestId = useRef(0);

  // Marks the trigger once React has hydrated and the onClick / Ctrl+K
  // listeners are live. SSR HTML renders the button visibly BEFORE hydration,
  // so tests (and fast users) must wait for this flag — a click on the
  // pre-hydration button silently does nothing.
  useEffect(() => {
    triggerRef.current?.setAttribute("data-hydrated", "true");
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setGroups(null);
    setStatus("idle");
    setActiveIndex(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  // ── Ctrl+K / Cmd+K opens from anywhere except a text field ────────────────
  // Two instances mount on dashboard pages (sidebar + mobile header) and both
  // listen. The hidden-breakpoint one must NOT answer: it would open an
  // invisible dialog and steal autofocus from the dialog the user can see.
  // The visible instance wins; clicks can only ever reach a visible trigger
  // anyway, so exactly one dialog opens and owns focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        if (isTypingTarget(e.target)) return;
        if (triggerRef.current && triggerRef.current.offsetParent === null) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus the box on open so typing starts immediately (mobile keyboard too).
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open ]);

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    // Under 2 chars the server returns page shortcuts with no DB reads; still
    // debounce so holding a key doesn't spam the action. The loading flag is
    // set from inside the scheduled timeout (not synchronously in the effect
    // body) so the effect never triggers a cascading render.
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await globalSearch(query);
        if (requestId.current !== id) return;
        if (!res.ok) {
          setGroups(null);
          setStatus("error");
          return;
        }
        setGroups(res.data);
        setStatus("idle");
        setActiveIndex(0);
      } catch {
        if (requestId.current !== id) return;
        setGroups(null);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [open, query]);

  // Flat row list across groups — arrow keys walk answers, not group headers.
  const flat: SearchHit[] = groups
    ? GROUP_ORDER.flatMap(({ key }) => groups[key])
    : [];
  const hasResults = flat.length > 0;
  const showNoResults = status === "idle" && groups !== null && !hasResults;

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length,
      );
    } else if (e.key === "Enter") {
      const hit = flat[activeIndex];
      if (hit) {
        e.preventDefault();
        go(hit.href);
      }
    }
  };

  // Keep the highlighted row scrolled into view as arrows move.
  useEffect(() => {
    document
      .getElementById(`global-search-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex ]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        data-testid="global-search-trigger"
        aria-label="Search products, customers, sales, or pages"
        className="relative inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 lg:px-3"
      >
        {/* Touch target: the visible chip stays h-9 so the POS header keeps its
            pre-Step-5 height (a 44px-tall button stretched it ~8px and squeezed
            the cart below one line on short viewports). The invisible hit area
            still meets the 44px floor. */}
        <span aria-hidden className="absolute -inset-2 sm:-inset-1.5" />
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        {/* Label ladder — driven by the POS header's height, not by taste.

            At 1280x720 the till header row has only ~30px of slack (see
            PosHeader), and a wide chip squeezes the `min-w-0` brand group until
            the breadcrumb wraps to three lines. That grew the header 55→81px and
            stole 26px from the cart — Phase 4's short-laptop cart floor failed
            at 45px. So the FULL sentence only appears at 2xl+; between xl and
            2xl the chip is icon + shortcut (the magnifier already says "search");
            below xl it is icon + "Search…" (no room for the kbd there either).
            The Ctrl K kbd stays at xl+ because the dialog's shortcut is asserted
            visible at 1280. */}
        <span className="hidden max-w-44 truncate 2xl:inline">Search products, customers, sales, or pages…</span>
        <span className="hidden sm:inline xl:hidden">Search…</span>
        <kbd
          aria-hidden
          className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 xl:inline-block"
        >
          Ctrl K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          data-testid="global-search-dialog"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div aria-hidden className="pointer-events-none fixed inset-0 bg-white/45 backdrop-blur-[3px]" />
          <div className="pointer-events-none relative flex min-h-full items-start justify-center p-4 pt-[10vh] sm:p-6">
            <div
              className="pointer-events-auto my-auto flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_40px_-12px_rgba(15,23,42,0.28)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
                <Search className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search products, customers, sales, or pages…"
                  aria-label="Search products, customers, sales, or pages"
                  aria-expanded={hasResults}
                  aria-controls="global-search-results"
                  aria-activedescendant={
                    hasResults ? `global-search-option-${activeIndex}` : undefined
                  }
                  role="combobox"
                  autoComplete="off"
                  data-testid="global-search-input"
                  className="min-h-[44px] w-full bg-transparent text-base text-slate-900 placeholder-slate-400 outline-none"
                />
                {status === "loading" ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-slate-400" aria-hidden />
                ) : (
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close search"
                    className="shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>

              <GlobalSearchResults
                status={status}
                groups={groups}
                activeIndex={activeIndex}
                showNoResults={showNoResults}
                onGo={go}
                onHover={setActiveIndex}
              />

              <div className="hidden shrink-0 items-center gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 sm:flex">
                <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-semibold">↑↓</kbd> move</span>
                <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-semibold">Enter</kbd> open</span>
                <span><kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-semibold">Esc</kbd> close</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

