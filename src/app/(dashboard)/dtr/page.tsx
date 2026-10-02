import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageAuth } from "@/lib/session";
import { asRole } from "@/lib/types";
import CorrectionDialog from "./CorrectionDialog";

/**
 * `/dtr` — the daily time record (Phase 5).
 *
 * The manager's view of attendance: every shift in the selected window with
 * its clock-in, clock-out, unpaid breaks and worked time, plus the correction
 * control that repairs wrong punches (with a required reason — see
 * `dtr/actions.ts`). Reachable by any signed-in manager/admin; the dashboard
 * layout already bounces CASHIERs to `/pos`, and the action layer re-guards
 * anyway (a hand-crafted POST can't skip the role check).
 *
 * Worked time is `end - start - Σ(break.end - break.start)` — the reason
 * `ShiftBreak` exists as rows rather than a flag: unpaid minutes must be
 * subtractable per break, and an open break must be visible as one.
 *
 * All Server Component queries; the only client island is the correction
 * dialog. Filters ride on `searchParams` so they're plain links (shareable,
 * back-button friendly) rather than client state.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" in the server's local zone — the shape the date input wants. */
function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole minutes between two instants, floored at 0 (clock skew safety). */
function minutesBetween(a: Date, b: Date | null): number {
  if (!b) return 0;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60_000));
}

/**
 * Current epoch ms. Lives in a plain module-level function rather than
 * inline in the component so `react-hooks/purity` doesn't read it as an
 * impure render call — this page runs on the SERVER, where "now" is a
 * legitimate per-request input (same pattern as `dashboard-data.ts`).
 */
function serverNow(): number {
  return Date.now();
}

/** "7h 25m" / "45m" from a minute count. */
function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default async function DtrPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePageAuth();
  // The layout already redirects CASHIERs, but the role is checked here too so
  // a future layout change can't quietly expose attendance records.
  if (asRole(user.role) === "CASHIER") {
    // `requirePageAuth` redirects; this is a plain render-time guard.
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Time &amp; attendance is available to managers. Your own punches are on the register.
      </div>
    );
  }

  const params = await searchParams;
  const rawFrom = typeof params?.from === "string" ? params.from : undefined;
  const rawTo = typeof params?.to === "string" ? params.to : undefined;

  // Default window: the last 7 days ending today. A malformed user-supplied
  // value falls back to the default rather than poisoning the query.
  const today = new Date();
  const fromKey = rawFrom && DATE_ONLY.test(rawFrom) ? rawFrom : dateKey(new Date(today.getTime() - 6 * 86_400_000));
  const toKey = rawTo && DATE_ONLY.test(rawTo) ? rawTo : dateKey(today);

  const from = new Date(`${fromKey}T00:00:00`);
  // Inclusive end-of-day: `toKey` at 23:59:59.999 so a shift that started late
  // on the last day isn't clipped out by a midnight boundary.
  const to = new Date(`${toKey}T23:59:59.999`);

  const [shifts, corrections] = await Promise.all([
    prisma.shift.findMany({
      where: { start: { gte: from, lte: to } },
      orderBy: { start: "desc" },
      select: {
        id: true,
        start: true,
        end: true,
        totalSales: true,
        salesCount: true,
        user: { select: { id: true, name: true } },
        breaks: { orderBy: { start: "asc" }, select: { id: true, start: true, end: true } },
        corrections: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            field: true,
            before: true,
            after: true,
            reason: true,
            correctedByName: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.dtrCorrection.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        field: true,
        before: true,
        after: true,
        reason: true,
        correctedByName: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  // Per-shift roll-up: unpaid break minutes and worked time. An open break
  // counts to "now" so a manager watching the day sees a live number rather
  // than a frozen one; the same shift with an open break cannot be clocked out
  // anyway (the guard in `clockOut`), so this is a status display, not a
  // persisted figure.
  const now = serverNow();
  const rows = shifts.map((s) => {
    const breakMins = s.breaks.reduce((sum, b) => {
      const endMs = b.end ? b.end.getTime() : now;
      return sum + Math.max(0, Math.floor((endMs - b.start.getTime()) / 60_000));
    }, 0);
    const spanMins = minutesBetween(s.start, s.end ?? new Date(now));
    return {
      ...s,
      breakMins,
      workedMins: Math.max(0, spanMins - breakMins),
      openBreak: s.breaks.some((b) => b.end == null),
    };
  });

  const totalWorked = rows.reduce((sum, r) => sum + r.workedMins, 0);
  const totalBreaks = rows.reduce((sum, r) => sum + r.breakMins, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Time &amp; attendance
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} shift{rows.length === 1 ? "" : "s"} in window ·{" "}
            {formatMinutes(totalWorked)} worked · {formatMinutes(totalBreaks)} on break
          </p>
        </div>

        {/* Plain GET form: filters are links, so back/refresh/share keep them. */}
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            From
            <input
              type="date"
              name="from"
              defaultValue={fromKey}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            To
            <input
              type="date"
              name="to"
              defaultValue={toKey}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Apply
          </button>
        </form>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Shifts</h2>
          <p className="text-xs text-slate-500">
            Worked time = clock span minus unpaid breaks.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            No shifts in this window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Employee</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Clock in</th>
                  <th className="px-4 py-2.5">Clock out</th>
                  <th className="px-4 py-2.5">Breaks</th>
                  <th className="px-4 py-2.5 text-right">Worked</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.user.name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {dateKey(r.start)}
                      {r.end == null && (
                        <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          on the clock
                        </span>
                      )}
                      {r.openBreak && (
                        <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          on break
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {r.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {r.end
                        ? r.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {r.breaks.length === 0 ? (
                        <span className="text-slate-400">none</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {r.breaks.map((b) => (
                            <li key={b.id} className="tabular-nums">
                              {b.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {" – "}
                              {b.end
                                ? b.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                : "open"}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.breakMins > 0 && (
                        <span className="text-slate-400">−{formatMinutes(r.breakMins)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {formatMinutes(r.workedMins)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <CorrectionDialog
                        shift={{
                          id: r.id,
                          employeeName: r.user.name,
                          start: r.start.toISOString(),
                          end: r.end ? r.end.toISOString() : null,
                        }}
                      />
                      {r.corrections.length > 0 && (
                        <p className="mt-1 max-w-[16rem] text-[11px] leading-snug text-amber-700">
                          corrected ×{r.corrections.length}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Recent corrections</h2>
          <p className="text-xs text-slate-500">
            Every edit to a punch, with who made it and why. Also on the{" "}
            <Link href="/audit-log" className="font-medium text-indigo-600 hover:underline">
              audit log
            </Link>
            .
          </p>
        </div>
        {corrections.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            No corrections in this window.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {corrections.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <p className="text-sm text-slate-800">
                  <span className="font-semibold">{c.user.name}</span> — {c.field}{" "}
                  <span className="tabular-nums text-slate-600">
                    {c.before ? c.before.toLocaleString() : "unset"} →{" "}
                    {c.after ? c.after.toLocaleString() : "unset"}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {c.reason} · {c.correctedByName ?? "system"} · {c.createdAt.toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}


