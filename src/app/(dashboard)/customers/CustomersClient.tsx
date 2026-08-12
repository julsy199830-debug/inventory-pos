"use client";

import { useMemo, useState } from "react";
import {
  createCustomer,
  getCustomers,
  getCustomerStatement,
  recordCustomerPayment,
  updateCustomer,
  type CustomerRow,
  type CustomerStatement,
} from "./actions";

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
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none";
const primary =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50";
const ghost =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50";

export function CustomersClient({ initialRows }: { initialRows: CustomerRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", creditLimit: "", notes: "" });
  const [paying, setPaying] = useState<CustomerRow | null>(null);
  const [payment, setPayment] = useState({ amount: "", method: "CASH", notes: "" });
  const [viewing, setViewing] = useState<CustomerRow | null>(null);
  const [statements, setStatements] = useState<Record<string, CustomerStatement>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  async function reload() {
    const res = await getCustomers(query);
    if (res.ok) setRows(res.data);
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Directory, credit limits, and debt tracking (“utang”).</p>
        </div>
        <button
          type="button"
          className={primary}
          onClick={() => {
            setEditing(null);
            setForm({ name: "", email: "", phone: "", creditLimit: "", notes: "" });
          }}
        >
          Add Customer
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, phone, or email…"
        className={`${input} mt-4 max-w-sm`}
      />

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Credit Limit</th>
              <th className="px-4 py-3">Current Debt</th>
              <th className="px-4 py-3">History</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                <td className="px-4 py-3 text-slate-600">{r.phone ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{f(r.creditLimit)}</td>
                <td className="px-4 py-3">
                  <span className={r.currentBalance > 0 ? "font-semibold text-red-600" : "text-slate-400"}>
                    {f(r.currentBalance)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {r.salesCount} sale{r.salesCount === 1 ? "" : "s"} · {r.paymentsCount} payment
                  {r.paymentsCount === 1 ? "" : "s"}
                </td>
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
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No customers found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(form.name !== "" || editing) && (
        <Modal
          title={editing ? "Edit Customer" : "Add Customer"}
          onClose={() => {
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
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={ghost} onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className={primary} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Add Customer"}</button>
            </div>
          </form>
        </Modal>
      )}

      {paying && (
        <Modal title={`Receive Payment — ${paying.name}`} onClose={() => setPaying(null)}>
          <form onSubmit={pay} className="space-y-3">
            <p className="text-sm text-slate-500">
              Outstanding debt: <span className="font-semibold text-red-600">{f(paying.currentBalance)}</span>
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
        <Modal title={`Statement — ${statement.customer.name}`} onClose={() => setViewing(null)}>
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Credit Limit</p>
              <p className="text-sm font-semibold">{f(statement.customer.creditLimit)}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3">
              <p className="text-xs text-red-500">Current Debt</p>
              <p className="text-sm font-semibold text-red-600">{f(statement.customer.currentBalance)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Loyalty Points</p>
              <p className="text-sm font-semibold">{statement.customer.loyaltyPoints}</p>
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
              <tbody className="divide-y divide-slate-100">
                {statement.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 text-slate-600">{fd(e.date)}</td>
                    <td className="py-2">
                      <span className={e.type === "SALE"
                        ? "rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600"
                        : "rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600"}>
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
                    <td colSpan={3} className="py-8 text-center text-slate-400">No credit activity yet.</td>
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}