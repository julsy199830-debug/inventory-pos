import { getCustomerStatement } from "../actions";
import { prisma } from "@/lib/db";
import { requirePageAuth } from "@/lib/session";
import { getFormatSettings, getStoreIdentity } from "@/lib/store-config";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
} from "@/lib/format";
import { exportStatementCsv } from "./export";
import AccountFilters from "./AccountFilters";

export const metadata = { title: "Customer account — InvPos" };

/**
 * Phase 6 — the dedicated customer account page.
 *
 * Every figure comes from the shared ledger in `@/lib/ledger`, rebuilt from the
 * underlying sale / refund / payment / adjustment records. Nothing here
 * recomputes a balance or trusts `Customer.currentBalance` as an authority —
 * that is the whole point of having a ledger.
 *
 * Scope: the customer id comes from the ROUTE and nothing else, so there is no
 * query parameter that can widen it. Auth is a hard requirement, so an
 * anonymous request never reaches the query at all.
 *
 * Date filtering keeps the running balance honest: `buildLedger` sums the FULL
 * history first and then filters, so the balance shown is what the customer
 * actually owed at the end of the window — not a balance rebuilt from the window
 * in isolation.
 */

const KIND_LABEL: Record<string, string> = {
  CHARGE: "Charge (on account)",
  PAYMENT: "Payment",
  REFUND: "Refund",
  VOID: "Voided",
  ADJUSTMENT: "Adjustment",
};

const KIND_TONE: Record<string, string> = {
  CHARGE: "bg-rose-50 text-rose-700",
  PAYMENT: "bg-indigo-50 text-indigo-700",
  REFUND: "bg-amber-50 text-amber-700",
  VOID: "bg-slate-100 text-slate-600",
  ADJUSTMENT: "bg-violet-50 text-violet-700",
};

/** Parse `YYYY-MM-DD` as local midnight, or null when absent/malformed. */
function parseDay(value: string | string[] | undefined): Date | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function CustomerAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requirePageAuth();
  const { id } = await params;
  const sp = await searchParams;

  const from = parseDay(sp.from);
  const to = parseDay(sp.to);
  // A "to" date is inclusive, so stretch it to the end of that day.
  const toEnd = to
    ? new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999)
    : null;

  const [statementRes, format, store] = await Promise.all([
    getCustomerStatement(id, { from, to: toEnd }),
    getFormatSettings(),
    getStoreIdentity(),
  ]);

  if (!statementRes.ok) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-0">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {statementRes.error}
        </p>
      </div>
    );
  }

  const { customer, entries, balance, totalCharges, totalPayments } =
    statementRes.data;

  // Loyalty history, straight from the append-only event table.
  const loyalty = await prisma.loyaltyEvent.findMany({
    where: { customerId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      delta: true,
      kind: true,
      reason: true,
      createdAt: true,
    },
  });

  // Refunds and adjustments totalled from the SAME ledger rows the table below
  // renders, so a summary tile can never disagree with the rows it summarises.
  let refundTotal = 0;
  let adjustmentTotal = 0;
  for (const e of entries) {
    if (e.kind === "REFUND") refundTotal += Math.abs(e.amount);
    if (e.kind === "ADJUSTMENT") adjustmentTotal += Math.abs(e.amount);
  }

  const creditAvailable =
    customer.creditLimit > 0 ? Math.max(0, customer.creditLimit - balance) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {customer.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Account statement
            {customer.phone && ` · ${customer.phone}`}
            {customer.email && ` · ${customer.email}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={exportStatementCsv({ customer, entries, format })}
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            data-testid="statement-export"
          >
            Export CSV
          </a>
          <button
            type="button"
            className="inline-flex items-center rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            data-testid="statement-print"
          >
            Print statement
          </button>
        </div>
      </header>

      <AccountFilters
        from={sp.from as string | undefined}
        to={sp.to as string | undefined}
      />

      {/* Summary. Every figure here is ledger-derived except the credit limit,
          which is a policy setting rather than a movement. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Outstanding balance" value={formatMoney(balance, format)} tone={balance > 0 ? "rose" : "slate"} />
        <Tile label="Charges" value={formatMoney(totalCharges, format)} />
        <Tile label="Payments" value={formatMoney(totalPayments, format)} />
        <Tile label="Refunds" value={formatMoney(refundTotal, format)} />
        <Tile label="Adjustments" value={formatMoney(adjustmentTotal, format)} />
        <Tile label="Credit limit" value={customer.creditLimit > 0 ? formatMoney(customer.creditLimit, format) : "None"} />
        <Tile label="Credit available" value={creditAvailable === null ? "—" : formatMoney(creditAvailable, format)} />
        <Tile label="Loyalty points" value={formatNumber(customer.loyaltyPoints, format)} />
      </section>

      {/* The ledger. Every row carries its own running balance, so the column can
          be checked line by line against the records that caused it. */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm" data-testid="account-ledger">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Detail</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/80">
            {entries.map((e) => (
              <tr key={`${e.kind}-${e.id}`} data-ledger-kind={e.kind}>
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                  {formatDate(e.date, format)}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${KIND_TONE[e.kind]}`}>
                    {KIND_LABEL[e.kind]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {e.label}
                  {e.detail && (
                    <span className="block text-xs text-slate-400">{e.detail}</span>
                  )}
                </td>
                {/* The sign is explicit so a reader never has to infer direction
                    from colour alone. */}
                <td
                  className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                    e.amount > 0
                      ? "text-rose-600"
                      : e.amount < 0
                        ? "text-emerald-600"
                        : "text-slate-400"
                  }`}
                >
                  {e.amount === 0
                    ? "—"
                    : `${e.amount > 0 ? "+" : "−"}${formatMoney(Math.abs(e.amount), format)}`}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                  {formatMoney(e.balance, format)}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  No account activity in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Loyalty history — from the append-only event table, so a points
          balance can be explained rather than merely asserted. */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
          Loyalty activity
        </h2>
        <table className="w-full text-sm" data-testid="loyalty-history">
          <tbody className="divide-y divide-slate-200/80">
            {loyalty.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                  {formatDateTime(l.createdAt, format)}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{l.reason}</td>
                <td className="px-4 py-2.5">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {l.kind}
                  </span>
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                    l.delta > 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {l.delta > 0 ? "+" : "−"}
                  {formatNumber(Math.abs(l.delta), format)}
                </td>
              </tr>
            ))}
            {loyalty.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No loyalty activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <footer className="text-xs text-slate-400">
        Statement for {store.storeName} · generated{" "}
        {formatDateTime(new Date(), format)}
      </footer>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "rose";
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        tone === "rose" ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"
      }`}
    >
      <p className={`text-xs ${tone === "rose" ? "text-rose-600" : "text-slate-500"}`}>
        {label}
      </p>
      <p
        className={`mt-0.5 text-base font-semibold tabular-nums ${
          tone === "rose" ? "text-rose-700" : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}