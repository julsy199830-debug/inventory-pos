import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  Clock,
  Package,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import { getFormatSettings } from "@/lib/store-config";
import { formatMoney, formatNumber, formatTime } from "@/lib/format";
import { RANGE_LABELS, resolveRange } from "@/lib/analytics";
import { Panel } from "@/app/_components/ui/Panel";
import { RangeTabs } from "@/app/_components/ui/RangeTabs";
import { ShareBars } from "@/app/_components/ui/ShareBars";
import { StatCard } from "@/app/_components/ui/StatCard";
import OperationalAlerts from "./_components/OperationalAlerts";
import ActivityByHour from "./_components/ActivityByHour";
import RevenueTrendChart from "./_components/RevenueTrendChart";
import {
  getDashboardData,
  getOperationalAlerts,
  getTodayFocus,
} from "./dashboard-data";

/**
 * Dashboard (Phase 7) — the starting point for someone who has never used this.
 *
 * It answers four questions in a fixed order, and the order IS the design:
 *
 *   1. Where am I?      -> the greeting names the person and their role.
 *   2. What is happening? -> "Today", plain figures for today only.
 *   3. What needs my attention? -> "Needs Attention", only when there is
 *      something. A dashboard that shows an empty alert list teaches the user
 *      that the section is decoration.
 *   4. What should I do next? -> "Quick Actions", filtered to the role, with
 *      every button going somewhere real.
 *
 * Every figure is still computed by the existing `getDashboardData` / analytics
 * helpers — this file only arranges them. No sales, inventory, loyalty, refund,
 * void, DTR or purchasing rule was changed, and no card recomputes a total in
 * JSX. Where a figure has a detailed screen, the card links to it instead of
 * pretending to be that screen.
 *
 * Range selection stays URL-driven (`?range=`) via plain links, matching the
 * inventory and audit-log filters, so a view can be bookmarked and the page
 * stays statically prerenderable with no client navigation state.
 */
export default async function DashboardPage({
  searchParams,
}: {
  // searchParams is a Promise in this Next.js version - see the page file
  // convention docs on handling filtering with searchParams.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { range } = await searchParams;
  const rangeKey = resolveRange(range);
  // Phase 4: the alerts feed is a THIRD read, not part of `getDashboardData`,
  // because it is a fixed "right now" view while the rest of the dashboard
  // honours the selected range. Folding it into the range query would make a
  // 7-day alert window silently drift with whichever tab is open.
  const [data, format, alerts, focus] = await Promise.all([
    getDashboardData(rangeKey),
    getFormatSettings(),
    getOperationalAlerts(),
    getTodayFocus(),
  ]);

  const isCashier = focus.user.role === "CASHIER";

  /**
   * Quick actions, filtered to the role.
   *
   * A CASHIER is redirected away from this page by the (dashboard) layout, so
   * this list is what a MANAGER/ADMIN sees — but the filter is kept explicit
   * rather than assumed, so a future cashier-reachable dashboard cannot silently
   * show buttons the server would reject.
   *
   * Every label states what the click ACTUALLY does. There is deliberately no
   * "Add Product" → `/inventory?new=1` style deep link here: neither the
   * inventory nor the customers page reads a query param to auto-open its
   * dialog, so that button would land the user on the right page with nothing
   * opened — a promise the app does not keep. Labelling the links for where they
   * really go keeps the "no dead actions" rule intact; opening the form directly
   * is a separate, deliberate improvement to those two pages.
   */
  const quickActions = [
    { label: "Open POS", href: "/pos", icon: ShoppingCart, always: true },
    { label: "My Transactions", href: "/my-transactions", icon: Receipt, always: true },
    { label: "Products & Stock", href: "/inventory", icon: Package, always: false },
    { label: "Receive Stock", href: "/purchasing", icon: Boxes, always: false },
    { label: "Customers", href: "/customers", icon: Users, always: false },
    { label: "Time & Attendance", href: "/dtr", icon: Clock, always: false },
    { label: "Sales Reports", href: "/reports", icon: TrendingUp, always: false },
  ].filter((a) => a.always || !isCashier);
  
  const { totals, today, valuation, adjustments } = data;

  /**
   * "Needs attention" rows, derived — not queried separately.
   *
   * Everything here already exists in `data`/`focus`; this only decides what is
   * worth interrupting the user for. Each entry pairs a plain-language problem
   * with ONE action that fixes it, which is the whole point: a warning the user
   * cannot act on is noise.
   *
   * Ordering is by urgency, not by how easy it was to query.
   */
  const attention: {
    key: string;
    title: string;
    detail: string;
    action: string;
    href: string;
    urgent: boolean;
  }[] = [];

  if (valuation.outOfStock > 0) {
    attention.push({
      key: "out-of-stock",
      title: `${valuation.outOfStock} product${valuation.outOfStock === 1 ? "" : "s"} out of stock`,
      detail: "You cannot sell these until you restock them.",
      action: "Review products",
      href: "/inventory?status=out",
      urgent: true,
    });
  }
  if (focus.pendingOrders.length > 0) {
    const first = focus.pendingOrders[0];
    attention.push({
      key: "pending-orders",
      title: `${focus.pendingOrders.length} order${focus.pendingOrders.length === 1 ? "" : "s"} waiting to be received`,
      detail: `Oldest is ${first.poNumber} from ${first.supplier}.`,
      action: "Receive stock",
      href: `/purchasing/${first.id}`,
      urgent: true,
    });
  }
  if (valuation.lowStock > 0) {
    attention.push({
      key: "low-stock",
      title: `${valuation.lowStock} product${valuation.lowStock === 1 ? "" : "s"} running low`,
      detail:
        focus.lowStock.length > 0
          ? `Lowest: ${focus.lowStock[0].name} (${focus.lowStock[0].stock} left).`
          : "Order more before these run out.",
      action: "Review products",
      href: "/inventory?status=low",
      urgent: false,
    });
  }
  if (!focus.shift) {
    attention.push({
      key: "not-clocked-in",
      title: "You are not clocked in",
      detail: "Clock in so your hours and sales are recorded against you.",
      action: "Open POS",
      href: "/pos",
      urgent: false,
    });
  }
  if (adjustments.totalGivenBack > 0) {
    attention.push({
      key: "refunds",
      title: `${formatMoney(adjustments.totalGivenBack, format)} refunded or voided ${RANGE_LABELS[rangeKey].toLowerCase()}`,
      detail:
        adjustments.ratePercent == null
          ? "No sales in this window."
          : `${adjustments.ratePercent.toFixed(1)}% of gross sales.`,
      action: "See sales",
      href: "/reports",
      urgent: false,
    });
  }

  return (
    <div className="space-y-8">
      {/* ── 1. Where am I? ──────────────────────────────────────────────────
          Names the person and their role. A first-time user opening the app has
          no other way to know whose session this is. */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {/* "Dashboard" is the page's real heading, so it is an <h1>: a screen
                reader and a document outline both need a heading that names the
                page, not just a greeting. It is styled as a quiet eyebrow so the
                greeting still reads as the visual lead. */}
            <h1 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Dashboard
            </h1>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              Hello, {focus.user.name.split(" ")[0]}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {focus.user.role === "ADMIN"
                ? "Administrator"
                : focus.user.role === "MANAGER"
                  ? "Manager"
                  : "Cashier"}
              {focus.shift
                ? ` · On shift since ${formatTime(focus.shift.startedAt, format)}`
                : " · Not clocked in"}
            </p>
          </div>
          {/* The window is its own element so it can be read (and asserted on)
              independently of the label beside it. */}
          <div className="text-right">
            <RangeTabs active={rangeKey} short />
            <p className="mt-2 text-xs tabular-nums text-slate-400">
              {data.range.from} to {data.range.to}
            </p>
          </div>
        </div>

        {/* ── 4. What should I do next? ─────────────────────────────────────
            Placed directly under the greeting on purpose: a new user should not
            have to scroll past charts to find the button they need. */}
        <nav
          aria-label="Quick actions"
          className="flex flex-wrap gap-2"
          data-testid="dashboard-quick-actions"
        >
          {quickActions.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <a.icon className="h-4 w-4 shrink-0" aria-hidden />
              {a.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* ── 2. What is happening today? ─────────────────────────────────────
          Today only, never the selected range — a user asking "how did today
          go" must not have to check which tab is open. */}
      <section aria-labelledby="dash-today" className="space-y-3">
        <h2
          id="dash-today"
          className="text-sm font-semibold uppercase tracking-wide text-slate-500"
        >
          Today
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Sales today"
            value={formatMoney(today.revenue, format)}
            hint={`${formatNumber(today.transactions, format)} transaction${today.transactions === 1 ? "" : "s"}`}
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            href="/reports"
          />
          <StatCard
            label="Average sale"
            value={formatMoney(today.averageOrder, format)}
            hint="per transaction today"
            icon={<Receipt className="h-4 w-4" aria-hidden />}
          />
          <StatCard
            label="Sales this period"
            value={formatMoney(totals.revenue, format)}
            change={data.revenueChange}
            hint={RANGE_LABELS[rangeKey]}
            icon={<Banknote className="h-4 w-4" aria-hidden />}
          />
          <StatCard
            label="Stock value"
            value={formatMoney(valuation.retailValue, format)}
            hint={`what {focus.lowStock.length} low item${focus.lowStock.length === 1 ? "" : "s"} could cost`}
            icon={<Boxes className="h-4 w-4" aria-hidden />}
            href="/inventory"
          />
        </div>
      </section>

      {/* ── 3. What needs my attention? ───────────────────────────────────────
          Rendered ONLY when something genuinely needs doing. An always-visible
          panel that is usually empty teaches a new user the section is
          decoration, and then they stop reading it on the day it matters. */}
      {attention.length > 0 && (
        <section
          aria-labelledby="dash-attention"
          className="space-y-3"
          data-testid="dashboard-needs-attention"
        >
          <h2
            id="dash-attention"
            className="text-sm font-semibold uppercase tracking-wide text-slate-500"
          >
            Needs attention
          </h2>
          <ul className="divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {attention.map((a) => (
              <li
                key={a.key}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AlertTriangle
                    className={`mt-0.5 h-4 w-4 shrink-0 ${a.urgent ? "text-rose-600" : "text-amber-600"}`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{a.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{a.detail}</p>
                  </div>
                </div>
                <Link
                  href={a.href}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {a.action}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* Phase 7: the three "restock pressure / value at risk / refunds" cards
          were replaced by the "Needs attention" list above. Each of them restated
          a number that list already carries as a plain-language problem WITH the
          action that fixes it, so keeping them duplicated the same facts twice
          and gave the user four separate places to read one warning. The
          `OperationalAlerts` feed is restored below because it is a different
          cut — per-SKU alerts rather than store-level ones. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Phase 4: per-SKU alert feed — a different cut from the store-level
            "Needs attention" list above, so both stay. */}
        <OperationalAlerts alerts={alerts} />

        <Panel
          title="Sales trend"
          subtitle={
            data.trend.length > 60 ? "Monthly totals" : "Daily totals"
          }
          className="xl:col-span-2"
        >
          <RevenueTrendChart
            data={data.trend.map((p) => ({ label: p.label, revenue: p.revenue }))}
            format={format}
          />
        </Panel>

        <Panel
          title="Activity by time"
          subtitle="Busiest hours, from actual sales"
        >
          <ActivityByHour buckets={data.hours} format={format} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Top-selling products"
          subtitle="By revenue in this window"
          action={
            <Link
              href="/reports"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Full report
            </Link>
          }
        >
          <ShareBars
            tone="indigo"
            rows={data.top.map((row) => ({
              label: row.label,
              detail: row.detail,
              value: formatMoney(row.revenue, format),
              share: row.share,
            }))}
          />
        </Panel>

        <Panel title="Sales by category" subtitle="Where the revenue comes from">
          <ShareBars
            tone="emerald"
            rows={data.categories.map((row) => ({
              label: row.label,
              value: formatMoney(row.revenue, format),
              share: row.share,
            }))}
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="By payment method" subtitle="Share of revenue">
          <ShareBars
            tone="slate"
            rows={data.payments.map((row) => ({
              label: paymentLabel(row.label),
              value: formatMoney(row.revenue, format),
              share: row.share,
            }))}
          />
        </Panel>

        <Panel
          title="Restock list"
          subtitle="Out of stock first, then nearest to empty"
          action={
            <Link
              href="/inventory?status=low"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Inventory
            </Link>
          }
        >
          {data.alerts.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Every product is above its low-stock threshold.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.alerts.map((alert) => (
                <li key={alert.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">
                      {alert.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {alert.sku} - {alert.categoryName}
                    </p>
                  </div>
                  <span
                    className={
                      alert.status === "out"
                        ? "shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"
                        : "shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
                    }
                  >
                    {alert.status === "out" ? "Out" : `${alert.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Cashier activity"
          subtitle="Sales handled in this window"
          action={
            <Link
              href="/employees"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              All staff
            </Link>
          }
        >
          {data.employees.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No staff records yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.employees.slice(0, 6).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">
                      {row.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {row.role.toLowerCase()} - {row.transactions} sale
                      {row.transactions === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                    {formatMoney(row.revenue, format)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent transactions"
        subtitle="Most recent sales in this window"
        bodyClassName="px-0 py-0"
      >
        {data.recent.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">No completed sales yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Sales appear here as soon as the register rings one up.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recent.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700"
                    aria-hidden
                  >
                    {sale.customer.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {sale.customer}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {sale.cashier} - {paymentLabel(sale.method)} -{" "}
                      {sale.at.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {sale.status !== "Completed" ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {sale.status}
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatMoney(sale.total, format)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** "STORE_CREDIT" -> "Store credit". Mirrors the POS's own payment labels. */
function paymentLabel(method: string): string {
  if (method === "CASH") return "Cash";
  if (method === "CARD") return "Card";
  if (method === "STORE_CREDIT") return "Store credit";
  return method
    .split("_")
    .map((word) => (word[0] ?? "").toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
