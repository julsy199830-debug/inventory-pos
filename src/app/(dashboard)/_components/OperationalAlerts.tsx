import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Panel } from "@/app/_components/ui/Panel";
import type { OperationalAlert } from "../dashboard-data";

/**
 * "Needs attention today" strip for the dashboard (Phase 4, section 6).
 *
 * Deliberately a COUNT LIST, not a score. Each tile is a plain number taken
 * straight from `getOperationalAlerts` and links to the screen that already
 * handles it. There is no composite health figure, because a number nobody can
 * trace back to a query is one a manager will act on and cannot verify.
 *
 * Only non-zero alerts are rendered - see the filter in `getOperationalAlerts`.
 * An all-clear is shown explicitly rather than leaving an empty box, so "nothing
 * needs doing" is visibly different from "this failed to load".
 */
const TONES = {
  danger: {
    card: "border-red-200 bg-red-50 hover:border-red-300",
    value: "text-red-700",
    icon: "text-red-600",
  },
  warning: {
    card: "border-amber-200 bg-amber-50 hover:border-amber-300",
    value: "text-amber-800",
    icon: "text-amber-600",
  },
  info: {
    card: "border-slate-200 bg-white hover:border-slate-300",
    value: "text-slate-900",
    icon: "text-slate-500",
  },
} as const;

export default function OperationalAlerts({ alerts }: { alerts: OperationalAlert[] }) {
  return (
    <Panel
      title="Needs attention"
      subtitle="Live counts from your own records — nothing here is estimated"
      action={
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          View inventory
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      }
    >
      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Nothing needs attention right now.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {alerts.map((a) => {
            const tone = TONES[a.tone];
            return (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className={`group flex items-start gap-3 rounded-xl border px-4 py-3 transition ${tone.card}`}
                >
                  <span className={`mt-0.5 shrink-0 ${tone.icon}`} aria-hidden>
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`text-lg font-bold tabular-nums ${tone.value}`}>
                        {a.count}
                      </span>
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {a.label}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-slate-600">
                      {a.detail}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}