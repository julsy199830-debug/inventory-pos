"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Route-level error boundary for `/dtr`.
 *
 * The dashboard group already has one, but a manager debugging an attendance
 * failure needs a route-specific way out: "back to the dashboard" is a real
 * destination here, not a generic retry, and this page is the one most likely
 * to throw (it aggregates every shift in a window, so a wide range over a big
 * ledger is the most expensive query in the app).
 *
 * `reset()` re-renders just this segment, so a transient failure is one click
 * from fixed. The digest is shown — enough for a support conversation, nothing
 * about the schema or the query.
 */
export default function DtrError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-100">
          <AlertTriangle className="h-6 w-6 text-rose-600" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-bold tracking-tight text-slate-900">
          Time &amp; attendance could not be loaded
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Nothing was changed — no punches were altered. Try again, or narrow the
          date range if the window you picked covers a lot of shifts.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-slate-400">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 active:scale-[0.98]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}