import { getFormatSettings } from "@/lib/store-config";
import { formatMoney } from "@/lib/format";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageAuth } from "@/lib/session";
import {
  HISTORY_PAYMENT_METHODS,
  HISTORY_STATUSES,
} from "@/app/pos/history-types";

/**
 * `/my-transactions` — the cashier's OWN sales ledger (Phase 5).
 *
 * The point of this page is scoping, not novelty: the shared "Transactions"
 * panel on the register shows every cashier's sales to anyone signed in, which
 * is right for a till and wrong for "what did *I* ring up?". This answers that
 * question without a new data model — `Sale.cashierId` already records it.
 *
 * SCOPE IS A SERVER QUERY FACT, NOT A FILTER:
 *
 *   - `cashierId: me.id` comes from the session and is ANDed into the WHERE
 *     clause. It is never read from `searchParams`, so no request a client can
 *     craft widens it. Every filter below is additive on top of it.
 *   - The detail route repeats the same AND (`id` + `cashierId`), so another
 *     cashier's sale is a 404 rather than a page that quietly renders it.
 *   - This is the deliberate counterpart to the punch actions in
 *     `employees/actions.ts`, where the id DOES come from the client and is
 *     therefore authorized explicitly. Here nothing is trusted, so nothing
 *     needs authorizing.
 *
 * Filters ride on `searchParams` so they are plain GET links — shareable and
 * back-button friendly, the same convention as `/dtr`.
 *
 * Sits OUTSIDE the `(dashboard)` route group for the same reason as
 * `/my-activity`: a CASHIER is redirected away from every management route, and
 * this is precisely the screen they need. It renders its own minimal chrome.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Midnight at the START of a local day. `new Date("YYYY-MM-DD")` parses as UTC
 * and would drop the wrong day's sales in a negative-offset zone, so the string
 * is split and rebuilt locally (same convention as `lib/analytics`).
 */
function localDayStart(key: string): Date | undefined {
  if (!DATE_ONLY.test(key)) return undefined;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Midnight at the START of the day AFTER `key` — an exclusive upper bound. */
function localDayEnd(key: string): Date | undefined {
  if (!DATE_ONLY.test(key)) return undefined;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0);
}

/** First 8 chars of the sale id — the "transaction number" a cashier reads. */
function txnNumber(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  STORE_CREDIT: "Store credit",
};

const STATUS_TONES: Record<string, string> = {
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "Partially Refunded": "bg-amber-50 text-amber-700 ring-amber-200",
  Refunded: "bg-slate-100 text-slate-600 ring-slate-200",
  Voided: "bg-red-50 text-red-700 ring-red-200",
};

/** Only one of the `searchParams` values, when it is a single string. */
function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export default async function MyTransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const me = await requirePageAuth();
  const params = await searchParams;

  const query = (one(params?.q) ?? "").trim();
  const fromKey = one(params?.from) ?? "";
  const toKey = one(params?.to) ?? "";
  const status = HISTORY_STATUSES.includes(one(params?.status) as never)
    ? one(params?.status)
    : undefined;
  const paymentMethod = HISTORY_PAYMENT_METHODS.includes(
    one(params?.payment) as never,
  )
    ? one(params?.payment)
    : undefined;

  const gte = localDayStart(fromKey);
  // Exclusive upper bound: covers the WHOLE of the "to" day without an
  // 23:59:59.999 hack, so a sale rung up late isn't clipped at midnight.
  const lt = localDayEnd(toKey);

  const [sales] = await Promise.all([
    prisma.sale.findMany({
      // `cashierId` is the scope. Session-derived, never client-supplied.
      where: {
        cashierId: me.id,
        ...(gte || lt
          ? { createdAt: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } }
          : {}),
        ...(status ? { status } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(query
          ? {
              OR: [
                { id: { contains: query } },
                { customer: { name: { contains: query } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        totalAmount: true,
        paymentMethod: true,
        status: true,
        refundedAmount: true,
        voidReason: true,
        customer: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const format = await getFormatSettings();

  const money = (n: number) => formatMoney(n, format);
  const netTotal = sales.reduce(
    (sum, s) => sum + s.totalAmount - s.refundedAmount,
    0,
  );
  const anyFilter = Boolean(
    query || fromKey || toKey || status || paymentMethod,
  );
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-xs font-bold text-white">
              IP
            </span>
            <div>
              <p className="text-base font-bold text-slate-900">
                My transactions
              </p>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {me.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/pos"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Register
            </Link>
            <Link
              href="/my-activity"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              My hours
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <p className="text-sm text-slate-500">
          Sales you rang up, newest first. Nobody else&apos;s transactions appear
          here.
        </p>
        <form
          method="GET"
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="text-xs font-medium text-slate-500">
            Search
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Transaction no. or customer"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            From
            <input
              type="date"
              name="from"
              defaultValue={fromKey}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            To
            <input
              type="date"
              name="to"
              defaultValue={toKey}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Status
            <select
              name="status"
              defaultValue={status ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All</option>
              {HISTORY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Payment
            <select
              name="payment"
              defaultValue={paymentMethod ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All</option>
              {HISTORY_PAYMENT_METHODS.map((p) => (
                <option key={p} value={p}>
                  {PAYMENT_LABELS[p] ?? p}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Apply
            </button>
            {anyFilter && (
              <Link
                href="/my-transactions"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear
              </Link>
            )}
            <span className="ml-auto text-xs text-slate-500">
              {sales.length} shown
              {sales.length === 50 ? " (most recent 50)" : ""} · net{" "}
              <span className="font-semibold tabular-nums text-slate-700">
                {money(netTotal)}
              </span>
            </span>
          </div>
        </form>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Sales</h2>
            <p className="text-xs text-slate-500">
              Net is the total after any refunds. Select one to view and reprint
              its receipt.
            </p>
          </div>

          {sales.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              {anyFilter
                ? "No transactions match those filters."
                : "You have not rung up any sales yet."}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sales.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/my-transactions/${s.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
                        <span className="font-mono text-xs font-semibold text-slate-500">
                          {txnNumber(s.id)}
                        </span>
                        <span className="tabular-nums text-slate-600">
                          {s.createdAt.toLocaleString()}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                            STATUS_TONES[s.status] ??
                            "bg-slate-100 text-slate-600 ring-slate-200"
                          }`}
                        >
                          {s.status}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {s._count.items} item
                        {s._count.items === 1 ? "" : "s"} ·{" "}
                        {PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}
                        {s.customer ? ` · ${s.customer.name}` : " · Walk-in"}
                        {s.refundedAmount > 0
                          ? ` · refunded ${money(s.refundedAmount)}`
                          : ""}
                        {s.voidReason ? ` · ${s.voidReason}` : ""}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {money(s.totalAmount)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}