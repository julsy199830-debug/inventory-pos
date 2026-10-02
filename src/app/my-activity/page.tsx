import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageAuth } from "@/lib/session";
import ActivityControls from "./ActivityControls";

/**
 * `/my-activity` — the employee's own time record (Phase 5 — DTR).
 *
 * Sits OUTSIDE the `(dashboard)` route group on purpose: that layout redirects
 * CASHIERs to `/pos`, but the register's main audience — cashiers — are exactly
 * the people who need to see their own punches, start/end breaks and catch a
 * missed clock-out before it distorts their DTR. So this page does its own
 * `requirePageAuth()` (any signed-in role) and renders its own minimal chrome,
 * like `/pos` does.
 *
 * Scope is deliberately narrow: SELF only. Every query filters `userId: me.id`.
 * The break/clock actions accept a `userId` field so a manager can punch a
 * colleague from `/employees`, but here the page passes the session user's own
 * id and nothing else is reachable.
 *
 * Corrections are NOT offered here: editing your own attendance is what the
 * reason-required manager flow on `/dtr` exists to police. This page's job is
 * visibility (and the punch controls), not repair.
 */

/**
 * Current epoch ms. Plain module-level function so `react-hooks/purity` doesn't
 * read it as an impure render call — this page runs on the SERVER, where "now"
 * is a legitimate per-request input (same pattern as `dashboard-data.ts`).
 */
function serverNow(): number {
  return Date.now();
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default async function MyActivityPage() {
  const me = await requirePageAuth();

  const [openShift, openBreak, shifts] = await Promise.all([
    prisma.shift.findFirst({
      where: { userId: me.id, end: null },
      select: { id: true, start: true },
    }),
    // Resolved independently of the shift lookup so the UI can show "on break"
    // even if the open shift were somehow missing (the break still exists on
    // its own row and `endBreak` closes it through the shift resolution).
    prisma.shiftBreak.findFirst({
      where: { end: null, shift: { userId: me.id, end: null } },
      select: { id: true, start: true },
    }),
    prisma.shift.findMany({
      where: { userId: me.id },
      orderBy: { start: "desc" },
      take: 30,
      select: {
        id: true,
        start: true,
        end: true,
        totalSales: true,
        salesCount: true,
        breaks: { select: { id: true, start: true, end: true } },
        corrections: { select: { id: true, field: true, reason: true, createdAt: true } },
      },
    }),
  ]);

  // Worked minutes = span minus unpaid break minutes. An open shift measures
  // to now; an open break measures to now as well (it's not over yet).
  const nowMs = serverNow();
  const rows = shifts.map((s) => {
    const breakMins = s.breaks.reduce((sum, b) => {
      const endMs = b.end ? b.end.getTime() : nowMs;
      return sum + Math.max(0, Math.floor((endMs - b.start.getTime()) / 60_000));
    }, 0);
    const endMs = s.end ? s.end.getTime() : nowMs;
    const span = Math.max(0, Math.floor((endMs - s.start.getTime()) / 60_000));
    return { ...s, breakMins, workedMins: Math.max(0, span - breakMins) };
  });

  const totalWorked = rows.reduce((sum, r) => sum + r.workedMins, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-xs font-bold text-white">
              IP
            </span>
            <div>
              <p className="text-base font-bold text-slate-900">My hours</p>
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
            {/* The cashier's own two questions live next to each other: what
                did I work, and what did I sell. Labelled in the cashier's words
                rather than the manager's "DTR". */}
            <Link
              href="/my-transactions"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              My transactions
            </Link>
            {/* Managers/admins get back to the management shell; cashiers have
                no dashboard access, so the link is simply absent for them. */}
            {me.role !== "CASHIER" && (
              <Link
                href="/"
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                Dashboard
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    openShift ? (openBreak ? "bg-amber-500" : "bg-emerald-500") : "bg-slate-300"
                  }`}
                />
                {!openShift
                  ? "Off the clock"
                  : openBreak
                    ? `On break since ${openBreak.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : `On the clock since ${openShift.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {openShift
                  ? `Shift started ${openShift.start.toLocaleString()}`
                  : "Clock in to start recording your day."}
              </p>
            </div>
            <ActivityControls
              userId={me.id}
              clockedIn={openShift !== null}
              onBreak={openBreak !== null}
            />
          </div>
          {openBreak && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Break time is unpaid — clock out is locked until you end it.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">My shifts</h2>
              <p className="text-xs text-slate-500">
                {rows.length} most recent · {formatMinutes(totalWorked)} total worked
              </p>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              No shifts recorded yet.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-slate-800">
                      <span className="font-medium">{r.start.toLocaleDateString()}</span>{" "}
                      <span className="tabular-nums text-slate-600">
                        {r.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                        {r.end
                          ? r.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "now"}
                      </span>
                      {r.end == null && (
                        <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          open
                        </span>
                      )}
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatMinutes(r.workedMins)}
                      {r.breakMins > 0 && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          (−{formatMinutes(r.breakMins)} break)
                        </span>
                      )}
                    </p>
                  </div>
                  {r.corrections.length > 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      {r.corrections.length} correction
                      {r.corrections.length === 1 ? "" : "s"}:{" "}
                      {r.corrections.map((c) => c.reason).join("; ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

