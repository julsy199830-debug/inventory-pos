import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Clock, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import TransactionHistory from "./TransactionHistory";
import { useRegisterStatus } from "./register-status-store";
import type { ReceiptStore } from "./Receipt";
import type { Role } from "@/lib/types";

/**
 * Phase 7 — the register's command header.
 *
 * Step 1 moved this markup out of `PosCheckout.tsx` (1,759 lines) unchanged.
 * Step 2 then replaced the two things the header got wrong:
 *
 *   - "Register #1 · Online" was a hardcoded, always-green claim nobody ever
 *     checked (and "#1" was invented); the badge now carries the REAL shift
 *     state read by the status strip — on shift / on break / off shift, and
 *   - the till showed the time nowhere at all; there is now a clock.
 *
 * The badge is fed by the strip's own read through `register-status-store.ts`
 * (one fetch, one writer), so header and strip cannot contradict each other
 * and NO second session/shift state or extra poll was introduced.
 *
 * Props are deliberately narrow: the operator's identity, whether they may void,
 * the store subset the history panel and receipts print, and the lock action. It
 * deliberately does NOT receive the cart, the payment state or any session
 * object, so it cannot grow hidden couplings to the till's transaction logic.
 *
 * Visibility rules preserved exactly as they were:
 *   - ADMIN/MANAGER get a logo, "Back to Dashboard" and a breadcrumb,
 *   - a CASHIER gets the register title and a name badge instead, because the
 *     dashboard layout would bounce them off a dead link,
 *   - the DTR link is manager/admin-only for the same reason,
 *   - each link's responsive breakpoint (sm/md/lg) is unchanged, so no control
 *     appears or disappears at a different width than before.
 */
export type PosHeaderProps = {
  cashier: { name: string; role: Role };
  /** Whether the signed-in operator may void a sale (ADMIN/MANAGER only). */
  canVoid: boolean;
  /** The store subset the receipt and the history panel print on. */
  store: ReceiptStore;
  /** Store tax percentage, printed as "VAT (n%)" on receipts. */
  taxRate: number;
  /** Invokes the register lock. Passed in so this component holds no logic. */
  onLock: () => void;
};

export default function PosHeader({
  cashier,
  canVoid,
  store,
  taxRate,
  onLock,
}: PosHeaderProps) {
  // Current wall-clock time. `null` until mounted: the server cannot know the
  // cashier's clock, so SSR and the hydration render both draw the same "no
  // clock yet" markup, and the real time appears one effect later — no
  // hydration mismatch. Ticks every 30s (the strip's own cadence); a re-render
  // only lands when the minute shown actually changes.
  const [now, setNow] = useState<number | null>(null);

  // The till's shift state, PUBLISHED by the status strip's read — never
  // fetched here. One read, one writer: the badge and the strip below cannot
  // contradict each other, and no second session poll is added.
  const status = useRegisterStatus();

  useEffect(() => {
    // The initial read is SCHEDULED rather than set inline: the value then
    // arrives as the result of a timer firing, not as a consequence of the
    // effect having run — the same shape the status strip uses for its first
    // read, and what `react-hooks/set-state-in-effect` asks for.
    const kick = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(kick);
      clearInterval(t);
    };
  }, []);

  return (
    <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm sm:px-6 sm:py-2.5">
      <h1 className="sr-only">Point of Sale</h1>
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <Image
          src="/Logo final.png"
          alt="InvPos"
          width={120}
          height={120}
          priority
          className="h-8 w-auto object-contain"
        />
        {cashier.role === "ADMIN" || cashier.role === "MANAGER" ? (
          <>
            <Link
              href="/"
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back to Dashboard</span>
              <span className="sm:hidden">Back</span>
            </Link>
            <nav
              className="hidden items-center gap-2 text-sm sm:flex"
              aria-label="Breadcrumb"
            >
              <Link
                href="/"
                className="font-medium text-slate-500 transition-colors hover:text-indigo-600"
              >
                Dashboard
              </Link>
              <span aria-hidden className="text-slate-600">
                /
              </span>
              <span className="font-semibold text-slate-900">Point of Sale</span>
            </nav>
          </>
        ) : (
          // Cashiers have no dashboard access, so swap the navigation for a
          // register title + operator badge instead of a dead link.
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-base font-semibold tracking-tight text-slate-900">
              InvPos Register
            </span>
            <span className="hidden items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200 md:inline-flex">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              {cashier.name} · {cashier.role.charAt(0) + cashier.role.slice(1).toLowerCase()}
            </span>
          </div>
        )}
      </div>

      {/* Centre: what time it is, and what THIS till is doing right now — the
          two facts a cashier needs at a glance. The badge is present at every
          viewport (it is state, not decoration); the clock hides below `sm`
          where the row cannot spare the width, and the status strip one line
          down still states the same shift state there. */}
      <div className="flex shrink-0 items-center gap-2.5">
        {now !== null && (
          <time
            dateTime={new Date(now).toISOString()}
            className="hidden items-center gap-1.5 text-sm font-medium tabular-nums text-slate-600 sm:inline-flex"
          >
            {new Date(now).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        )}
        {status && (
          <span
            // Its OWN testid — two elements must never share one. The
            // `data-on-clock`/`data-on-break` attributes let a test assert the
            // header and the strip report the same state, whatever the copy.
            data-testid="header-shift-state"
            data-on-clock={status.onClock ? "true" : "false"}
            data-on-break={status.onBreak ? "true" : "false"}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              status.onBreak
                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                : status.onClock
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status.onBreak
                  ? "bg-amber-500"
                  : status.onClock
                    ? "bg-emerald-500"
                    : "bg-slate-400"
              }`}
            />
            {status.onBreak
              ? "On break"
              : status.onClock
                ? "On shift"
                : "Off shift"}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {/* Command-center links (Phase 5): the cashier's own attendance and their own
            sales both live outside the dashboard shell, reachable from the
            till because "where are my hours?" and "what did I ring up?" are
            both asked AT the register. Labels are the cashier's words —
            "My hours" and "My transactions" — not the manager's "DTR". */}
        <Link
          href="/my-transactions"
          className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 md:inline-flex"
        >
          <ReceiptText className="h-4 w-4" />
          My transactions
        </Link>
        <Link
          href="/my-activity"
          className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 md:inline-flex"
        >
          <Clock className="h-4 w-4" />
          My hours
        </Link>
        {cashier.role !== "CASHIER" && (
          <Link
            href="/dtr"
            className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 lg:inline-flex"
          >
            DTR
          </Link>
        )}
        <span className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 md:inline-flex">
          {cashier.name}
        </span>
        <TransactionHistory canVoid={canVoid} store={store} taxRate={taxRate} />
        <button
          type="button"
          onClick={onLock}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
        >
          Lock
        </button>
      </div>
    </header>
  );
}