"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  createCustomer,
  getCustomers,
  getCustomerStatement,
  recordCustomerPayment,
  updateCustomer,
  type CustomerRow,
  type CustomerStatement,
} from "./actions";
import { downloadCsv } from "@/lib/csv";
import { Modal } from "@/app/_components/ui/Modal";

/** Rows per page. Small enough to scan, large enough to avoid constant paging. */
const PAGE_SIZE = 12;

/**
 * Hydration snapshots, identical to the ones in `Modal` — see the `hydrated`
 * flag below for what the value is used for. `subscribe` is a no-op because
 * hydration happens once per page load, so there is nothing to listen to.
 */
const noopSubscribe = () => () => {};
/** True from the first client render onward. */
const clientSnapshot = () => true;
/** False during SSR and the hydration render, so server and client markup match. */
const serverSnapshot = () => false;

/** How the customer list can be ordered. */
type SortKey = "name" | "debt" | "points" | "spent" | "lastSeen";

/** The sort options offered, in the order they appear in the control. */
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "debt", label: "Debt" },
  { value: "points", label: "Points" },
  { value: "spent", label: "Total spent" },
  { value: "lastSeen", label: "Last purchase" },
];

/** "3 days ago" / "never" - recency reads faster than a date in a dense table. */
function sinceLabel(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

const f = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n);
const fd = (d: Date) =>
  new Date(d).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const input =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-500 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10";
const primary =
  "inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";
const ghost =
  "inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700";

export function CustomersClient({ initialRows }: { initialRows: CustomerRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", creditLimit: "", notes: "" });
  const [paying, setPaying] = useState<CustomerRow | null>(null);
  const [payment, setPayment] = useState({ amount: "", method: "CASH", notes: "" });
  const [viewing, setViewing] = useState<CustomerRow | null>(null);
  // Phase 4: sort key + direction, and the current page.
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [statements, setStatements] = useState<Record<string, CustomerStatement>>({});

  /**
   * Hydration flag, exposed as `data-customers-hydrated` on the root element.
   *
   * The whole list is server-rendered, so the table — and the search box — are
   * in the DOM well before React has attached `onChange`. Until then typing
   * writes the DOM value but never reaches `setQuery`, so the filter silently
   * does nothing: the input shows the query and the table still shows the whole
   * book. A test that fills and immediately asserts on the filtered result can
   * hit that window under a parallel run, so this is the marker it waits on
   * instead of guessing — the same trick as the register's
   * `data-register-loaded`.
   *
   * Same `useSyncExternalStore` shape as `Modal`'s `mounted` flag: `subscribe`
   * is a no-op because hydration happens exactly once, and the server snapshot
   * is `false` so the server and hydration markup stay identical.
   */
  const hydrated = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);

  /**
   * Phase 4: search, then sort, then page.
   *
   * Sorting is applied before pagination so "top debtors" or "most points" is a
   * real answer across the whole book rather than across one page of it. Every
   * comparator falls back to the name, so two customers with the same debt or
   * the same points never swap places between renders.
   */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...searched].sort((a, b) => {
      switch (sortBy) {
        case "debt":
          return (a.currentBalance - b.currentBalance) * dir || a.name.localeCompare(b.name);
        case "points":
          return (a.loyaltyPoints - b.loyaltyPoints) * dir || a.name.localeCompare(b.name);
        case "spent":
          return (a.totalSpent - b.totalSpent) * dir || a.name.localeCompare(b.name);
        case "lastSeen":
          return (
            (new Date(a.lastSaleAt ?? 0).getTime() -
              new Date(b.lastSaleAt ?? 0).getTime()) *
              dir || a.name.localeCompare(b.name)
          );
        case "name":
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
  }, [searched, sortBy, sortDir]);

  // Pagination is client-side because `getCustomers` already returns the whole
  // book. Splitting it server-side would mean a re-query per keystroke of the
  // search box, which is the opposite of what a manager typing a phone number
  // wants.
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const filtered = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Any change to the result set can strand the viewer past the last page, so
  // the page resets rather than leaving an empty table with no explanation.
  //
  // The reset is done in the handlers that change those inputs (search on
  // change, sort on change) plus after a reload, rather than in an effect keyed
  // on the same values: a `setPage` inside an effect re-renders the table a
  // second time on every keystroke, and the React Compiler rules reject it.
  // `safePage` already clamps defensively, so a missed reset can never show an
  // out-of-range page.
  const resetPage = useCallback(() => setPage(1), []);

  async function reload() {
    const res = await getCustomers(query);
    if (res.ok) {
      setRows(res.data);
      setPage(1);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      creditLimit: Number(form.creditLimit || 0),
      notes: form.notes || null,
    };
    const res = editing ? await updateCustomer(editing.id, payload) : await createCustomer(payload);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setFormOpen(false);
    setForm({ name: "", email: "", phone: "", creditLimit: "", notes: "" });
    setEditing(null);
    await reload();
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!paying) return;
    setBusy(true);
    setError(null);
    const res = await recordCustomerPayment({
      customerId: paying.id,
      amount: Number(payment.amount),
      paymentMethod: payment.method,
      notes: payment.notes || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setPaying(null);
    setPayment({ amount: "", method: "CASH", notes: "" });
    await reload();
  }

  async function openStatement(row: CustomerRow) {
    const res = await getCustomerStatement(row.id);
    if (res.ok) {
      setStatements((s) => ({ ...s, [row.id]: res.data }));
      setViewing(row);
    } else setError(res.error);
  }

  const statement = viewing ? statements[viewing.id] : null;

  return (
    <div
      className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-0"
      data-customers-hydrated={hydrated ? "true" : "false"}
    >
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Directory, credit limits, and debt tracking (“utang”).</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Export CSV — serializes the filtered ledger (name, contacts,
              credit limit, outstanding debt, history counts) for the
              bookkeeper. Client-side blob, no server round-trip. */}
          <button
            type="button"
            className={ghost}
            disabled={filtered.length === 0}
            onClick={() =>
              downloadCsv(
                "invpos-customers.csv",
                ["Name", "Phone", "Email", "Credit Limit", "Current Debt", "Sales", "Payments"],
                filtered.map((r) => [
                  r.name,
                  r.phone ?? "",
                  r.email ?? "",
                  r.creditLimit,
                  r.currentBalance,
                  r.salesCount,
                  r.paymentsCount,
                ]),
              )
            }
          >
            Export CSV
          </button>
          <button
            type="button"
            className={primary}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
              setError(null);
              setForm({ name: "", email: "", phone: "", creditLimit: "", notes: "" });
            }}
          >
            Add Customer
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {/* Search and sort sit on one row so a manager can narrow and reorder
          without the controls wrapping onto separate lines on a laptop. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            resetPage();
          }}
          placeholder="Search by name, phone, or email…"
          aria-label="Search customers"
          className={`${input} sm:max-w-sm`}
        />
        <div className="flex items-center gap-2 sm:ml-auto">
          <label htmlFor="customer-sort" className="text-xs font-medium text-slate-500">
            Sort by
          </label>
          <select
            id="customer-sort"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as SortKey);
              resetPage();
            }}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              resetPage();
            }}
            aria-label={sortDir === "asc" ? "Sort descending" : "Sort ascending"}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Credit Limit</th>
              <th className="px-4 py-3">Current Debt</th>
              <th className="px-4 py-3">History</th>
              <th className="px-4 py-3">Points</th>
              <th className="px-4 py-3">Total spent</th>
              <th className="px-4 py-3">Last purchase</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/80">
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.phone ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{f(r.creditLimit)}</td>
                <td className="px-4 py-3">
                  <span className={r.currentBalance > 0 ? "font-semibold text-red-600" : "text-slate-500"}>
                    {f(r.currentBalance)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {r.salesCount} sale{r.salesCount === 1 ? "" : "s"} · {r.paymentsCount} payment
                  {r.paymentsCount === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-700">
                  {r.loyaltyPoints}
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{f(r.totalSpent)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{sinceLabel(r.lastSaleAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button type="button" className={ghost} onClick={() => openStatement(r)}>
                      Statement
                    </button>
                    {r.currentBalance > 0 && (
                      <button
                        type="button"
                        className={ghost}
                        onClick={() => {
                          setPaying(r);
                          setError(null);
                        }}
                      >
                        Record Payment
                      </button>
                    )}
                    <button
                      type="button"
                      className={ghost}
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                        setError(null);
                        setForm({
                          name: r.name,
                          email: r.email ?? "",
                          phone: r.phone ?? "",
                          creditLimit: String(r.creditLimit),
                          notes: "",
                        });
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">No customers found.</td>
              </tr>
            )}
          </tbody>
          </table>
        </div>

        {/* Count + pager. The count is stated even on a single page, so a
            manager can tell "showing everything" from "showing page 1 of 4". */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-600">
            {sorted.length === 0
              ? "No customers"
              : pageCount === 1
                ? `${sorted.length} customer${sorted.length === 1 ? "" : "s"}`
                : `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(
                    safePage * PAGE_SIZE,
                    sorted.length,
                  )} of ${sorted.length}`}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs tabular-nums text-slate-600">
                Page {safePage} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage === pageCount}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {formOpen && (
        <Modal
          open
          title={editing ? "Edit Customer" : "Add Customer"}
          description={
            editing
              ? "Update this customer's details."
              : "Add a customer to track loyalty points and store credit."
          }
          busy={busy}
          onClose={() => {
            setFormOpen(false);
            setForm({ name: "", email: "", phone: "", creditLimit: "", notes: "" });
            setEditing(null);
          }}
        >
          <form onSubmit={save} className="space-y-3">
            <input className={input} placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className={input} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className={input} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className={input} placeholder="Credit limit (0 = no credit)" type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} />
            <textarea className={input} placeholder="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
              <button type="button" className={ghost} onClick={() => { setFormOpen(false); setEditing(null); setForm({ name: "", email: "", phone: "", creditLimit: "", notes: "" }); }}>Cancel</button>
              <button type="submit" className={primary} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Add Customer"}</button>
            </div>
          </form>
        </Modal>
      )}

      {paying && (
        <Modal open title={`Receive Payment — ${paying.name}`} onClose={() => setPaying(null)}>
          <form onSubmit={pay} className="space-y-3">
            <p className="text-sm text-slate-500">
              Outstanding debt: <span className="font-semibold text-rose-600">{f(paying.currentBalance)}</span>
            </p>
            <input className={input} placeholder="Amount *" type="number" min="0.01" step="0.01" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} required />
            <select className={input} value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })}>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="GCASH">GCash</option>
              <option value="OTHER">Other</option>
            </select>
            <textarea className={input} placeholder="Notes (optional)" rows={2} value={payment.notes} onChange={(e) => setPayment({ ...payment, notes: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={ghost} onClick={() => setPaying(null)}>Cancel</button>
              <button type="submit" className={primary} disabled={busy}>{busy ? "Recording…" : "Record Payment"}</button>
            </div>
          </form>
        </Modal>
      )}

      {viewing && statement && (
        <Modal open title={`Statement — ${statement.customer.name}`} onClose={() => setViewing(null)}>
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Credit Limit</p>
              <p className="text-sm font-semibold text-slate-900">{f(statement.customer.creditLimit)}</p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-xs text-rose-600">Current Debt</p>
              <p className="text-sm font-semibold text-rose-700">{f(statement.customer.currentBalance)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Loyalty Points</p>
              <p className="text-sm font-semibold text-slate-900">{statement.customer.loyaltyPoints}</p>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {statement.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 text-slate-600">{fd(e.date)}</td>
                    <td className="py-2">
                      <span className={e.type === "SALE"
                        ? "rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"
                        : "rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"}>
                        {e.type === "SALE" ? "On Account" : "Payment"} · {e.paymentMethod}
                      </span>
                    </td>
                    <td className="py-2 text-right font-medium">
                      {e.type === "SALE" ? "+" : "−"}
                      {f(e.amount)}
                    </td>
                  </tr>
                ))}
                {statement.entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-slate-500">No credit activity yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
