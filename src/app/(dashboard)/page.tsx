import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageAuth } from "@/lib/session";
import {
  Banknote,
  BarChart3,
  Clock3,
  Package,
  Receipt,
  Tags,
  Wallet,
} from "lucide-react";
import ActivityHeatmap from "./_components/ActivityHeatmap";
import RevenueTrendChart, { type TrendPoint } from "./_components/RevenueTrendChart";

/**
 * Dashboard home — live store overview in the dark charcoal redesign.
 *
 * A Server Component that computes every figure directly from Prisma (no mock
 * numbers), fed by the same row of completed `Sale`s used everywhere else in
 * the app. The `?range=week|month|year` query (awaited via the Promise
 * `searchParams` prop, matching the inventory/accounting page convention)
 * drives the window for the metric cards, revenue trend, category bars, and
 * the day×hour heatmap; the toggle in the top nav is plain links, so the page
 * stays statically prerenderable with zero client navigation state.
 *
 * Layout mirrors the visual reference: a charcoal sheet with a top navigation
 * bar (greeting + timeframe), four metric cards, a category-volume bar panel,
 * and a bottom row of three cards — Analytics (Recharts area), Activity by
 * time (heatmap), and Recent transactions.
 */

type RangeKey = "week" | "month" | "year";

const RANGE_DEFS: { key: RangeKey; label: string; days: number }[] = [
  { key: "week", label: "Week", days: 6 },
  { key: "month", label: "Month", days: 29 },
  { key: "year", label: "Year", days: 364 },
];

const RANGE_LABELS: Record<RangeKey, string> = {
  week: "This week",
  month: "This month",
  year: "This year",
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Normalize `?range=` into a known preset; anything unrecognized falls back
 *  to "month" (the same token-strict convention as the accounting page). */
function resolveRange(value: string | string[] | undefined): RangeKey {
  const token = Array.isArray(value) ? value[0] : value;
  return RANGE_DEFS.some((r) => r.key === token) ? (token as RangeKey) : "month";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function fmtMoney(value: number, symbol: string): string {
  const signed = value < 0 ? "-" : "";
  return `${signed}${symbol}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function paymentMethodLabel(method: string): string {
  if (method === "CASH") return "Cash";
  if (method === "CARD") return "Card";
  if (method === "STORE_CREDIT") return "Store credit";
  return method
    .split("_")
    .map((word) => (word[0] ?? "").toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** The slice of a `Sale` the dashboard needs, with the joins resolved. */
type SaleForOverview = {
  totalAmount: number;
  createdAt: Date;
  customer: { name: string } | null;
  cashier: { name: string } | null;
  items: {
    quantity: number;
    priceAtSale: number;
    product: { category: { name: string } | null } | null;
  }[];
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/** Revenue per time bucket: daily for week/month windows, monthly for year. */
function buildTrend(
  rangeKey: RangeKey,
  sales: SaleForOverview[],
  now: Date,
): TrendPoint[] {
  const totals = new Map<string, number>();
  const keyFor = (d: Date) => (rangeKey === "year" ? monthKey(d) : dayKey(d));
  for (const sale of sales) {
    const key = keyFor(sale.createdAt);
    totals.set(key, round2((totals.get(key) ?? 0) + sale.totalAmount));
  }

  const points: TrendPoint[] = [];
  if (rangeKey === "year") {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      points.push({
        label: SHORT_MONTHS[d.getMonth()],
        revenue: totals.get(monthKey(d)) ?? 0,
      });
    }
  } else {
    const days = RANGE_DEFS.find((r) => r.key === rangeKey)!.days;
    for (let i = days; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      points.push({
        label: rangeKey === "week" ? DAY_SHORT[d.getDay()] : `${d.getMonth() + 1}/${d.getDate()}`,
        revenue: totals.get(dayKey(d)) ?? 0,
      });
    }
  }
  return points;
}

type CategoryVolume = { name: string; revenue: number; share: number };

/** Per-category revenue share for the horizontal volume bars. */
function buildCategoryVolume(sales: SaleForOverview[]): CategoryVolume[] {
  const totals = new Map<string, number>();
  let grand = 0;
  for (const sale of sales) {
    for (const item of sale.items) {
      const name = item.product?.category?.name ?? "Uncategorized";
      const amount = item.quantity * item.priceAtSale;
      totals.set(name, (totals.get(name) ?? 0) + amount);
      grand += amount;
    }
  }
  return Array.from(totals.entries())
    .map(([name, revenue]) => ({
      name,
      revenue: round2(revenue),
      share: grand > 0 ? (revenue / grand) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
}

/** 7 (days, Monday-first) × 8 (3-hour slots) sale-count matrix. */
function buildHeatmap(
  sales: SaleForOverview[],
): { matrix: number[][]; maxCell: number } {
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => 0));
  for (const sale of sales) {
    const day = (sale.createdAt.getDay() + 6) % 7; // Monday = 0
    const slot = Math.min(7, Math.floor(sale.createdAt.getHours() / 3));
    matrix[day][slot] += 1;
  }
  const maxCell = Math.max(1, ...matrix.flat());
  return { matrix, maxCell };
}

type RecentSale = {
  id: string;
  time: Date;
  total: number;
  method: string;
  customer: string;
  cashier: string;
  categoryPills: string[];
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePageAuth();

  const { range } = await searchParams;
  const rangeKey = resolveRange(range);
  const days = RANGE_DEFS.find((r) => r.key === rangeKey)!.days;

  // Window: local midnight `days` back → now (POS days run on local wall-clock).
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - days);

  const [sales, settings, productCount, categoryCount] = await Promise.all([
    prisma.sale.findMany({
      where: { status: "Completed", createdAt: { gte: windowStart } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        totalAmount: true,
        subtotal: true,
        tax: true,
        paymentMethod: true,
        createdAt: true,
        customer: { select: { name: true } },
        cashier: { select: { name: true } },
        items: {
          select: {
            quantity: true,
            priceAtSale: true,
            product: { select: { category: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.storeSetting.findFirst(),
    prisma.product.count(),
    prisma.category.count(),
  ]);

  const symbol = settings?.currencySymbol ?? "₱";
  const firstName = user.name.split(/\s+/)[0] || user.name;

  const revenue = round2(sales.reduce((sum, sale) => sum + sale.totalAmount, 0));
  const orders = sales.length;
  const itemsSold = sales.reduce(
    (sum, sale) => sum + sale.items.reduce((a, item) => a + item.quantity, 0),
    0,
  );
  const avgOrderValue = orders > 0 ? revenue / orders : 0;

  const trend = buildTrend(rangeKey, sales, now);
  const categoryVolume = buildCategoryVolume(sales);
  const { matrix: heatmap, maxCell } = buildHeatmap(sales);

  const recentSales: RecentSale[] = sales.slice(0, 8).map((sale) => ({
    id: sale.id,
    time: sale.createdAt,
    total: sale.totalAmount,
    method: sale.paymentMethod,
    customer: sale.customer?.name ?? "Guest",
    cashier: sale.cashier?.name ?? "—",
    categoryPills: Array.from(
      new Set(sale.items.map((item) => item.product?.category?.name ?? "Uncategorized")),
    ).slice(0, 3),
  }));

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 shadow-lg shadow-slate-950/10">
      {/* ── Top navigation bar ─────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-5 py-5 sm:px-7">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            <span className="flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
            InvPos · Overview
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-white">
            Welcome back, {firstName}
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {RANGE_LABELS[rangeKey]} performance across {categoryCount.toLocaleString()}{" "}
            categor{categoryCount === 1 ? "y" : "ies"} and {productCount.toLocaleString()} products.
          </p>
        </div>

        <nav
          aria-label="Reporting timeframe"
          className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 p-1"
        >
          {RANGE_DEFS.map((r) => {
            const active = r.key === rangeKey;
            return (
              <Link
                key={r.key}
                href={`/?range=${r.key}`}
                aria-current={active ? "page" : undefined}
                className={[
                  "rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors",
                  active
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/25"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white",
                ].join(" ")}
              >
                {r.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-2 text-sm font-semibold text-indigo-300 transition hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-200"
        >
          Reports
        </Link>
      </header>

      {/* ── Headline metric cards ─────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Banknote}
          label="Total Revenue"
          value={fmtMoney(revenue, symbol)}
          hint={`${orders.toLocaleString()} completed order${orders === 1 ? "" : "s"} · ${RANGE_LABELS[rangeKey].toLowerCase()}`}
          gradient="from-indigo-500 to-violet-600"
        />
        <MetricCard
          icon={Receipt}
          label="Total Sales"
          value={orders.toLocaleString()}
          hint="Completed transactions in window"
          gradient="from-violet-500 to-fuchsia-500"
        />
        <MetricCard
          icon={Wallet}
          label="Avg. Order Value"
          value={fmtMoney(avgOrderValue, symbol)}
          hint="Revenue ÷ completed orders"
          gradient="from-indigo-400 to-indigo-600"
        />
        <MetricCard
          icon={Package}
          label="Items Sold"
          value={itemsSold.toLocaleString()}
          hint={`Across ${categoryVolume.length} active categor${categoryVolume.length === 1 ? "y" : "ies"}`}
          gradient="from-violet-400 to-indigo-500"
        />
      </section>

      {/* ── Bottom section: Analytics / Activity / Categories / Recent ── */}
      <div className="grid grid-cols-1 gap-5 pt-6 lg:grid-cols-3">
        <Panel
          title="Analytics"
          caption="Revenue trend · income over time"
          icon={BarChart3}
          className="lg:col-span-2"
        >
          <RevenueTrendChart data={trend} currencySymbol={symbol} />
        </Panel>

        <Panel
          title="Activity by time"
          caption="Peak sales hours · day × 3-hour slot"
          icon={Clock3}
        >
          <ActivityHeatmap matrix={heatmap} maxCell={maxCell} />
        </Panel>

        <Panel title="Category Volume" caption="Revenue share by category" icon={Tags}>
          <CategoryBars categories={categoryVolume} symbol={symbol} />
        </Panel>

        <Panel
          title="Recent Transactions"
          caption="Latest completed sales"
          icon={Receipt}
          className="lg:col-span-2"
        >
          <RecentSalesList sales={recentSales} symbol={symbol} />
        </Panel>
      </div>
    </div>
  );
}

/** One dark headline stat tile with a vibrant indigo/violet icon chip. */
function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  gradient,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
  hint?: string;
  gradient: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-md shadow-indigo-500/20`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {label}
        </p>
      </div>
      <p className="mt-4 text-3xl font-bold tabular-nums tracking-tight text-white">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/** Charcoal panel shell shared by the bottom cards. */
function Panel({
  title,
  caption,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  caption?: string;
  icon: typeof BarChart3;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col rounded-2xl border border-slate-800 bg-slate-900 ${className}`}>
      <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-indigo-300 ring-1 ring-slate-700">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-slate-200">{title}</h2>
          {caption && <p className="mt-0.5 text-xs text-slate-400">{caption}</p>}
        </div>
      </div>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

/** Horizontal revenue-share bars — deepest indigo for the top line. */
function CategoryBars({
  categories,
  symbol,
}: {
  categories: CategoryVolume[];
  symbol: string;
}) {
  if (categories.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-700">
        <p className="text-sm text-slate-400">No category sales in this window.</p>
      </div>
    );
  }
  const max = categories[0].revenue;
  return (
    <div className="space-y-3">
      {categories.map((category) => (
        <div key={category.name} className="min-w-0">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium text-slate-300">{category.name}</span>
            <span className="tabular-nums text-slate-400">
              {fmtMoney(category.revenue, symbol)} · {category.share.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-800">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
              style={{ width: `${Math.max(4, (category.revenue / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Live feed of the most recent completed sales. */
function RecentSalesList({
  sales,
  symbol,
}: {
  sales: RecentSale[];
  symbol: string;
}) {
  if (sales.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-700">
        <p className="text-sm text-slate-400">No completed sales yet.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-800">
      {sales.map((sale) => (
        <li key={sale.id} className="flex items-start gap-3 px-3 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/90 to-violet-600/90 text-xs font-bold text-white">
            {sale.customer.slice(0, 1).toUpperCase() || "G"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium text-slate-200">{sale.customer}</p>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-white">
                {fmtMoney(sale.total, symbol)}
              </p>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {sale.cashier} · {paymentMethodLabel(sale.method)} ·{" "}
              {sale.time.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
            {sale.categoryPills.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {sale.categoryPills.map((pill) => (
                  <span
                    key={pill}
                    className="inline-flex rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300 ring-1 ring-indigo-500/30"
                  >
                    {pill}
                  </span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}