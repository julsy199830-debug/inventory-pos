export default function Home() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Welcome Back, Manager
        </h1>
        <p className="text-sm text-slate-500">Here is what is happening today.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-5">
          <p className="text-sm font-medium text-slate-500">Today&apos;s Sales</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">₱1,240.50</p>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-5">
          <p className="text-sm font-medium text-slate-500">Weekly Sales</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">₱8,920.00</p>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-5">
          <p className="text-sm font-medium text-slate-500">Total Products</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">1,420</p>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-5">
          <p className="text-sm font-medium text-slate-500">Active Registers</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">3</p>
        </div>
      </div>

      {/* Inventory Alert Bar */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
          <p className="text-sm font-medium text-red-700">
            Critical Alert: 4 items are out of stock
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
          <p className="text-sm font-medium text-amber-800">
            Attention: 12 items are running low on stock
          </p>
        </div>
      </div>

      {/* Recent Transactions */}
      <RecentTransactions />
    </div>
  );
}

type Transaction = {
  orderId: string;
  customer: string;
  amount: string;
  method: "Cash" | "Card";
  status: "Completed" | "Refunded";
};

const transactions: Transaction[] = [
  {
    orderId: "ORD-1042",
    customer: "Elena Carter",
    amount: "₱32.40",
    method: "Card",
    status: "Completed",
  },
  {
    orderId: "ORD-1041",
    customer: "Marcus Lee",
    amount: "₱8.75",
    method: "Cash",
    status: "Completed",
  },
  {
    orderId: "ORD-1040",
    customer: "Priya Nair",
    amount: "₱54.20",
    method: "Card",
    status: "Refunded",
  },
];

function RecentTransactions() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          Recent Transactions
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Order ID</th>
              <th className="px-5 py-3 font-medium">Customer</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Payment Method</th>
              <th className="px-5 py-3 font-medium">Order Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.map((t) => (
              <tr key={t.orderId} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">
                  {t.orderId}
                </td>
                <td className="px-5 py-3 text-slate-600">{t.customer}</td>
                <td className="px-5 py-3 text-slate-900">{t.amount}</td>
                <td className="px-5 py-3 text-slate-600">{t.method}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Transaction["status"] }) {
  if (status === "Completed") {
    return (
      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
        Completed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
      Refunded
    </span>
  );
}
