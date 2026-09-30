"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Route-level error boundary for every page under `(dashboard)`.
 *
 * This is the ONE place the dashboard reports a server-side failure that happens
 * outside any component's own `try`/`catch` — a Prisma read that throws while a
 * page is streaming, a serializer that trips on a bad row. Without it Next falls
 * back to its built-in error screen, which is unstyled, offers no way back into
 * the app, and reads to a manager as "the product is broken" rather than "this
 * page needs another try".
 *
 * It deliberately shows the digest (not the stack): enough for a support
 * conversation, nothing about the schema or the query. `reset()` re-renders the
 * route's segment, so a transient failure is one button away from fixed — the
 * same "try again" affordance every inline error in the app already offers.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A boundary that mounts with an already-thrown error still needs to be
  // reported once; React's own dev overlay covers rethrows on later renders.
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
          This page could not be loaded
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Something went wrong while reading your data. Nothing was changed —
          try again, and if it keeps happening, reload the app.
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
