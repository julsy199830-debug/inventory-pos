"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Register error boundary.
 *
 * Same contract as the dashboard's, with copy written for a cashier rather than
 * a manager: the till is mid-sale when this fires, so the message has to say
 * plainly that the order is untouched and that retrying is safe. The cart lives
 * in component state, so a re-render of the segment is the whole recovery —
 * nothing keyed in is lost by pressing the button.
 */
export default function PosError({
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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-100">
          <AlertTriangle className="h-6 w-6 text-rose-600" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-bold tracking-tight text-slate-900">
          The register hit a problem
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          This screen could not be loaded. Your current order has not been
          charged — try again.
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
        </div>
      </div>
    </div>
  );
}
