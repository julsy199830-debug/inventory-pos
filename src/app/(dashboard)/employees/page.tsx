import { prisma } from "@/lib/db";
import { asRole, type Role } from "@/lib/types";
import AddEmployeeDialog from "./AddEmployeeDialog";
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
  /** Live completed-sale total rung up by this cashier (read fresh here so the
   *  current open shift's sales count in the summary). */
  liveSalesTotal: number;
  liveSalesCount: number;
};

/** The currency used by the POS — kept as a constant here so the summary tiles
 *  format consistently. Mirrors the `TAX_RATE`-style local constant note in the
 *  `StoreSetting` schema comment (these are externalized there, but the
 *  Employees summary predates wiring it in). */
const CURRENCY = "₱";

export default async function EmployeesPage() {
  // Fetched in parallel: the roster, every shift (with totals for performance),
  // and the cashiered live-sale aggregates. All Server Component Prisma queries.
  const [users, shifts, liveAgg] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.shift.findMany({
      orderBy: { start: "desc" },
      select: {
        id: true,
        userId: true,
        start: true,
        end: true,
        totalSales: true,
        salesCount: true,
      },
    }),
    prisma.sale.groupBy({
      by: ["cashierId"],
      where: { status: "Completed" },
      _sum: { totalAmount: true },
      _count: true,
    }),
  ]);

  // Index open shifts & lifetime snapshots by userId. A user may have at most
  // one open shift at a time (clockIn auto-closes a dangling prior one), so
  // `findLast` of the `end == null` rows picks the active one.
  const openByUserId = new Map<string, boolean>();
  const lifetimeSales = new Map<string, number>();
  const lifetimeCount = new Map<string, number>();
  for (const s of shifts) {
    if (s.end == null) openByUserId.set(s.userId, true);
    lifetimeSales.set(s.userId, (lifetimeSales.get(s.userId) ?? 0) + s.totalSales);
    lifetimeCount.set(s.userId, (lifetimeCount.get(s.userId) ?? 0) + s.salesCount);
  }

  // Live cashiered sales, keyed by cashierId (null buckets are irrelevant here).
  // `groupBy` types `_sum` as `... | null` (see `GetSaleGroupByPayload`), so we
  // null-chain it; `_count: true` resolves to a bare `number` there.
  const liveTotal = new Map<string, number>();
  const liveCount = new Map<string, number>();
  for (const a of liveAgg) {
    if (a.cashierId == null) continue;
    liveTotal.set(a.cashierId, a._sum?.totalAmount ?? 0);
    liveCount.set(a.cashierId, a._count);
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
    liveSalesTotal: liveTotal.get(u.id) ?? 0,
    liveSalesCount: liveCount.get(u.id) ?? 0,
  }));

  // ── Shift-management widget roll-up ────────────────────────────────────
  const clockedInList = employees.filter((e) => e.clockedIn);
  const activeCount = employees.filter((e) => e.active).length;
  // Lifetime total sales across all employees — a store-wide sales-volume read.
  const totalLifetimeSales = employees.reduce((sum, e) => sum + e.lifetimeSales, 0);
  const totalLiveSales = employees.reduce((sum, e) => sum + e.liveSalesTotal, 0);

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
        <AddEmployeeDialog />
      </header>

      {/* Performance summary tiles — quick KPIs derived from the shift + sale
          aggregates above. Mirrors the supplier header's compact stat style. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          label="On the clock"
          value={clockedInList.length.toLocaleString()}
          hint={clockedInList.length === 0 ? "No active shifts" : "Active shifts"}
          tone="emerald"
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
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Sales</th>
                <th className="px-5 py-3 font-medium">Shift</th>
                <th className="px-5 py-3 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">
                    {e.name}
                    {/* Inactive employees are dimmed so the roster reads at a
                        glance — visual only, the raw state drives the toggle. */}
                    {!e.active && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        (offboarded)
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{e.email}</td>
                  <td className="px-5 py-3">
                    <RoleSelect id={e.id} role={e.role} />
                  </td>
                  <td className="px-5 py-3">
                    <ToggleActiveButton
                      id={e.id}
                      active={e.active}
                      name={e.name}
                    />
                  </td>
                  <td className="px-5 py-3 text-slate-600">
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
                  <td className="px-5 py-3">
                    <ClockButton
                      userId={e.id}
                      clockedIn={e.clockedIn}
                    />
                  </td>
                  <td className="px-5 py-3 text-right">
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
  tone: "emerald" | "zinc";
}) {
  const accent =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-slate-100 text-slate-700";
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-4">
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
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-3">
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
        <ul className="divide-y divide-slate-100">
          {employees.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
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
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
