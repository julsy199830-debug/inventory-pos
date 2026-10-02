import { prisma } from "@/lib/db";
import Link from "next/link";
import { asRole, type Role } from "@/lib/types";
import AddEmployeeDialog from "./AddEmployeeDialog";
import EmployeePerformancePanel from "./EmployeePerformancePanel";
import { getEmployeePerformance } from "./performance-data";
import { getStoreSettings } from "@/app/actions/settings";
import EditEmployeeDialog from "./EditEmployeeDialog";
import DeleteEmployeeButton from "./DeleteEmployeeButton";
import ToggleActiveButton from "./ToggleActiveButton";
import RoleSelect from "./RoleSelect";
import ClockButton from "./ClockButton";

/**
 * Employees page — a Server Component composes three concerns:
 *
 *   1. A shift-management widget (who's currently clocked in, open-shift
 *      controls) backed by `clockIn` / `clockOut`.
 *   2. A performance summary derived from each employee's closed shifts
 *      (`Shift.totalSales` / `salesCount` snapshots) plus their live
 *      completed-sale total — the `Shift` model stamps totals at clock-out so
 *      historical performance is stable; the live figure is recomputed here so
 *      the current shift's in-progress sales count toward the summary too.
 *   3. The employee management table (CRUD, role assignment, active toggle)
 *      matching the customers/suppliers UI patterns.
 *
 * The `(dashboard)` route group is folder-only, so the public path is
 * `/employees` (no `(dashboard)` segment) — that's the path the actions
 * `revalidatePath` against.
 *
 * `role` arrives as a raw `String` from Prisma (SQLite has no native enum) and
 * is narrowed here via `asRole` for display + the type passed to the client
 * islands; the column's allowed values live in `ROLES` / the `Role` union.
 */

// ── Display shape passed to client islands ───────────────────────────────────
// Carrying the narrowed `role` (not the raw string) keeps the client components
// honest about which values exist — same trick the suppliers page uses with its
// `Supplier` type.
type EmployeeRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  clockedIn: boolean;
  /** Sum of `Shift.totalSales` snapshots for closed shifts (stable history). */
  lifetimeSales: number;
  /** Sum of `Shift.salesCount` snapshots for closed shifts. */
  lifetimeCount: number;
  /** This shift's ledger: completed sales rung up since the employee's current
   *  clock-in (`[shift.start, now)`), read fresh here so the live number needs
   *  no clock-out snapshot. 0 when the employee isn't clocked in. */
  liveSalesTotal: number;
  /** Count of completed sales in the current open-shift ledger. */
  liveSalesCount: number;
  /** Phase 5: the employee is on an unpaid break (open shift + open break). */
  onBreak: boolean;
  /** Phase 5: newest `LOGIN_SUCCESS` audit row, as an ISO string. Null when the
   *  employee has never signed in since logging was instrumented. */
  lastSignInAt: string | null;
  /** Phase 5: newest `Sale` they cashiered, as an ISO string. Null when they
   *  have never rung anything up. */
  lastSaleAt: string | null;
};

/**
 * Current epoch ms.
 *
 * Wrapped in a plain module-level function rather than calling `Date.now()`
 * inline: the `react-hooks/purity` lint rule reads a bare `Date.now()` in a
 * component body as an impure render. This page is a Server Component, where
 * "now" is a legitimate per-request input — the same reason the DTR and
 * `dashboard-data.ts` pages wrap it (see `serverNow` there).
 */
function serverNow(): number {
  return Date.now();
}

/**
 * "2h ago" / "3d ago" from a past instant.
 *
 * Coarse on purpose. This is a glanceable triage signal for a manager, not a
 * record — and a wrong-looking precise figure ("in 4 seconds") would invite a
 * manager to act on a number the schema does not actually support.
 */
function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "never";
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The currency used by the POS — kept as a constant here so the summary tiles
 *  format consistently. Mirrors the `TAX_RATE`-style local constant note in the
 *  `StoreSetting` schema comment (these are externalized there, but the
 *  Employees summary predates wiring it in). */
const CURRENCY = "₱";

export default async function EmployeesPage({
  searchParams,
}: {
  // searchParams is a Promise in this Next.js version - see the page file
  // convention docs on handling filtering with searchParams.
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Fetched in parallel: the roster, every shift (with totals for performance),
  // and the store-wide completed-sale aggregate (feeds the "Live sales (all
  // cashiers)" summary tile — the per-employee shift ledgers are windowed
  // separately below, so they can't share this all-time aggregate). All Server
  // Component Prisma queries.
  const [users, shifts, storeAgg, lastSignIns, lastSales] = await Promise.all([
    // Explicit select — deliberately NOT `findMany()`: a broad query would drag
    // `User.pin` (plaintext credential) and `User.passwordHash` into server
    // memory on every roster render. Only the roster-visible fields are needed;
    // see `EmployeeRow` + the `EditEmployeeDialog` props below.
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
      },
    }),
    prisma.shift.findMany({
      orderBy: { start: "desc" },
      select: {
        id: true,
        userId: true,
        start: true,
        end: true,
        totalSales: true,
        salesCount: true,
        // Phase 5: only the OPEN break per shift (at most one — `startBreak`
        // rejects a second), so the roster can show "on break" without loading
        // every historical break row.
        breaks: {
          where: { end: null },
          select: { id: true },
        },
      },
    }),
    prisma.sale.aggregate({
      _sum: { totalAmount: true },
      where: { status: "Completed" },
    }),
    // Phase 5 — the two activity signals that EXIST in the schema and can be
    // stated truthfully:
    //   - last successful sign-in: the newest `LOGIN_SUCCESS` audit row for
    //     that user (`pos/actions.ts` writes one per successful PIN).
    //   - last ring-up: the newest `Sale` they cashiered.
    // Both are one grouped query, not one-per-employee, so the roster cost
    // stays flat as headcount grows.
    //
    // Deliberately NOT "last seen": the session cookie carries no last-activity
    // stamp and nothing writes one, so any such column would be a guess. A
    // column that reads "active 4 minutes ago" because they last sold something
    // is worse than no column — it sends a manager after a non-problem.
    prisma.auditLog.groupBy({
      by: ["userId"],
      where: { action: "LOGIN_SUCCESS", userId: { not: null } },
      _max: { createdAt: true },
    }),
    prisma.sale.groupBy({
      by: ["cashierId"],
      where: { cashierId: { not: null } },
      _max: { createdAt: true },
    }),
  ]);

  const lastSignInAt = new Map<string, Date>();
  for (const row of lastSignIns) {
    if (row.userId && row._max.createdAt) {
      lastSignInAt.set(row.userId, row._max.createdAt);
    }
  }
  const lastSaleAt = new Map<string, Date>();
  for (const row of lastSales) {
    if (row.cashierId && row._max.createdAt) {
      lastSaleAt.set(row.cashierId, row._max.createdAt);
    }
  }

  // Index open shifts & lifetime snapshots by userId. A user may have at most
  // one open shift at a time (clockIn auto-closes a dangling prior one), so
  // `findLast` of the `end == null` rows picks the active one.
  const openByUserId = new Map<string, boolean>();
  const onBreakByUserId = new Map<string, boolean>();
  const lifetimeSales = new Map<string, number>();
  const lifetimeCount = new Map<string, number>();
  for (const s of shifts) {
    if (s.end == null) {
      openByUserId.set(s.userId, true);
      // The open-shift row's open break (if any) is the "on break" flag —
      // an open break can only exist on an open shift.
      if (s.breaks.length > 0) onBreakByUserId.set(s.userId, true);
    }
    lifetimeSales.set(s.userId, (lifetimeSales.get(s.userId) ?? 0) + s.totalSales);
    lifetimeCount.set(s.userId, (lifetimeCount.get(s.userId) ?? 0) + s.salesCount);
  }

  // "Sales this ledger" — each currently clocked-in employee's completed sales
  // rung up since their open shift began (`createdAt >= shift.start`; the upper
  // bound is implicit — `Sale.createdAt` defaults to server now() at insert, so
  // no row can be dated in the future). The window is per-employee, so we run
  // one aggregate per open shift (a user has at most one — `clockIn` auto-closes
  // a dangling prior one); a single `groupBy` can't express a per-bucket time
  // window. `_sum` types as `... | null`, so we null-chain it; `_count: true`
  // resolves to a bare `number` there (same shapes as the closed-shift snapshot
  // in `employees/actions.ts` `closeShift`).
  const openShifts = shifts.filter((s) => s.end == null);
  const ledgerAggs = await Promise.all(
    openShifts.map((s) =>
      prisma.sale.aggregate({
        _sum: { totalAmount: true },
        _count: true,
        where: {
          cashierId: s.userId,
          status: "Completed",
          createdAt: { gte: s.start },
        },
      }),
    ),
  );
  const ledgerTotal = new Map<string, number>();
  const ledgerCount = new Map<string, number>();
  for (const [i, s] of openShifts.entries()) {
    const agg = ledgerAggs[i];
    ledgerTotal.set(s.userId, Math.round((agg._sum.totalAmount ?? 0) * 100) / 100);
    ledgerCount.set(s.userId, agg._count);
  }

  const employees: EmployeeRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: asRole(u.role),
    active: u.active,
    clockedIn: openByUserId.has(u.id),
    lifetimeSales: lifetimeSales.get(u.id) ?? 0,
    lifetimeCount: lifetimeCount.get(u.id) ?? 0,
    liveSalesTotal: ledgerTotal.get(u.id) ?? 0,
    liveSalesCount: ledgerCount.get(u.id) ?? 0,
    onBreak: onBreakByUserId.has(u.id),
    lastSignInAt: lastSignInAt.get(u.id)?.toISOString() ?? null,
    lastSaleAt: lastSaleAt.get(u.id)?.toISOString() ?? null,
  }));

  // "Now" is read once here and passed to every relative-time call, so a column
  // can't disagree with itself mid-render. `serverNow()` rather than an inline
  // `Date.now()` — see that helper for why.
  const now = serverNow();

  // ── Shift-management widget roll-up ────────────────────────────────────
  const clockedInList = employees.filter((e) => e.clockedIn);
  const activeCount = employees.filter((e) => e.active).length;
  // Lifetime total sales across all employees — a store-wide sales-volume read.
  const totalLifetimeSales = employees.reduce((sum, e) => sum + e.lifetimeSales, 0);
  // Store-wide completed-sale volume across all time — independent of who's
  // clocked in, so it must not be derived from the shift-ledger figures above.
  const totalLiveSales = Math.round((storeAgg._sum.totalAmount ?? 0) * 100) / 100;

  // Phase 2: the sales-activity report for the chosen window. Fetched here
  // rather than inside a component so it shares this page's single render pass
  // and its auth check. Optional `searchParams` means the plain `/employees`
  // link still works - it just falls back to the default range.
  const sp = (await searchParams) ?? {};
  const rangeToken = sp.range;
  const [performance, settings] = await Promise.all([
    getEmployeePerformance(rangeToken),
    getStoreSettings(),
  ]);
  const currencySymbol = settings?.currencySymbol ?? "P";

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Employees
          </h1>
          <p className="text-sm text-slate-500">
            <span className="font-medium text-slate-900">{activeCount}</span> active
            of{" "}
            <span className="font-medium text-slate-900">
              {employees.length.toLocaleString()}
            </span>{" "}
            employees
          </p>
        </div>
        {/* "Add New Employee" trigger + modal. Client island; submits to the
            createEmployee Server Action, which inserts via Prisma and
            revalidates this page so the new row streams in. */}
        <div className="flex items-center gap-2">
          {/* Phase 5: jump from the roster to the attendance view (breaks,
              worked time, corrections) without hunting in the sidebar. */}
          <Link
            href="/dtr"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Time &amp; attendance
          </Link>
          <AddEmployeeDialog />
        </div>
      </header>

      {/* Phase 2: the sales-activity report. Sits directly under the header so
          "how is each cashier doing" is the first thing answered, with the
          roster and shift controls below it. */}
      <EmployeePerformancePanel
        data={performance}
        currencySymbol={currencySymbol}
        activeRange={Array.isArray(rangeToken) ? rangeToken[0] : rangeToken ?? ""}
      />

      {/* Performance summary tiles — quick KPIs derived from the shift + sale
          aggregates above. Mirrors the supplier header's compact stat style. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          label="On the clock"
          value={clockedInList.length.toLocaleString()}
          hint={clockedInList.length === 0 ? "No active shifts" : "Active shifts"}
          tone="blue"
        />
        <SummaryTile
          label="Active employees"
          value={activeCount.toLocaleString()}
          hint={`${employees.length - activeCount} inactive`}
          tone="zinc"
        />
        <SummaryTile
          label="Lifetime sales"
          value={`${CURRENCY}${totalLifetimeSales.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
          hint="Sum of closed-shift snapshots"
          tone="zinc"
        />
        <SummaryTile
          label="Live sales (all cashiers)"
          value={`${CURRENCY}${totalLiveSales.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
          hint="Completed sales, all shifts"
          tone="zinc"
        />
      </div>

      {/* Shift management widget — who is currently clocked in, with clock-in
          / clock-out controls. Reads from the same underlying shift data as the
          per-row ClockButton so the widget and table stay consistent. */}
      <ShiftWidget employees={clockedInList} />

      {/* Employee management table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Sales</th>
                <th className="px-4 py-3 font-medium">Shift</th>
                <th className="px-4 py-3 font-medium">Activity</th>
                <th className="px-4 py-3 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {employees.map((e) => (
                <tr key={e.id} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {e.name}
                    {/* Inactive employees are dimmed so the roster reads at a
                        glance — visual only, the raw state drives the toggle. */}
                    {!e.active && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        (offboarded)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{e.email}</td>
                  <td className="px-4 py-3">
                    <RoleSelect id={e.id} role={e.role} />
                  </td>
                  <td className="px-4 py-3">
                    <ToggleActiveButton
                      id={e.id}
                      active={e.active}
                      name={e.name}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className="font-medium text-slate-900">
                      {e.lifetimeCount.toLocaleString()}
                    </span>{" "}
                    sales ·{" "}
                    {CURRENCY}
                    {e.lifetimeSales.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <ClockButton
                      userId={e.id}
                      clockedIn={e.clockedIn}
                      onBreak={e.onBreak}
                    />
                  </td>
                  {/* Phase 5 activity. Two signals, each exactly what it says:
                      the last SUCCESSFUL sign-in, and the last sale they rang
                      up. There is deliberately no "last seen" — the session
                      cookie stores no activity stamp, so showing one would be a
                      fabricated number. The absolute time is in the `title` so a
                      manager who needs the exact moment can hover for it. */}
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <p
                      title={
                        e.lastSignInAt
                          ? `Signed in ${new Date(e.lastSignInAt).toLocaleString()}`
                          : "No recorded sign-in"
                      }
                      className="whitespace-nowrap"
                    >
                      Signed in {relativeTime(e.lastSignInAt, now)}
                    </p>
                    <p
                      title={
                        e.lastSaleAt
                          ? `Last sale ${new Date(e.lastSaleAt).toLocaleString()}`
                          : "No recorded sale"
                      }
                      className="whitespace-nowrap text-slate-500"
                    >
                      Last sale {relativeTime(e.lastSaleAt, now)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <EditEmployeeDialog
                        employee={{
                          id: e.id,
                          name: e.name,
                          email: e.email,
                          role: e.role,
                          active: e.active,
                        }}
                      />
                      <DeleteEmployeeButton id={e.id} name={e.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {employees.length === 0 && (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            No employees yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components (Server Components — no client state needed) ──────────────

/** A single KPI tile in the performance summary. Pure presentational, ke. */
function SummaryTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  /** Tailwind palette family; only the accent chips differ. */
  tone: "blue" | "zinc";
}) {
  const accent =
    tone === "blue"
      ? "bg-indigo-50 text-indigo-700"
      : "bg-slate-100 text-slate-700";
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${accent}`}>
        {hint}
      </p>
    </div>
  );
}

/**
 * Shift-management widget: lists employees currently on the clock with a
 * per-row clock-out control. Read from the page's `clockedInList`; an empty
 * list renders a friendly empty state rather than a bare panel, so the manager
 * always knows whether "nobody is clocked in" is a real state or a loading
 * artifact. Each row's `ClockButton` is a Client Component island (manages the
 * clock-out call + pending/error); the surrounding list is server-rendered.
 */
function ShiftWidget({ employees }: { employees: EmployeeRow[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">
          On the clock
        </h2>
        <p className="text-xs text-slate-500">
          {employees.length === 0
            ? "No active shifts right now."
            : `${employees.length} employee${employees.length === 1 ? "" : "s"} clocked in.`}
        </p>
      </div>

      {employees.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">
          Everyone is clocked out. Use a row&rsquo;s “Clock In” control to open a
          shift.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200/80">
          {employees.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {e.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {e.email} · {e.role}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">
                  <span className="font-medium text-slate-900">
                    {CURRENCY}
                    {e.liveSalesTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>{" "}
                  · {e.liveSalesCount.toLocaleString()} sales this ledger
                </span>
                <ClockButton
                  userId={e.id}
                  clockedIn={e.clockedIn}
                  onBreak={e.onBreak}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
