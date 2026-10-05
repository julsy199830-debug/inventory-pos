import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Clock, ReceiptText } from "lucide-react";
import TransactionHistory from "./TransactionHistory";
import type { ReceiptStore } from "./Receipt";
import type { Role } from "@/lib/types";

/**
 * Phase 7 — the POS header, extracted verbatim.
 *
 * This is a PURE REFACTOR. Nothing about what the header shows, when it shows,
 * or who can see which control has changed; the markup was moved out of
 * `PosCheckout.tsx` (1,759 lines) unchanged so the later Section 3 work has a
 * single, readable place to make the register understandable.
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

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="hidden sm:inline">Register #1 · </span>Online
        </span>
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