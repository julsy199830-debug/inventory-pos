"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Route-level error boundary for `/my-activity`.
 *
 * Needed because this route sits outside the `(dashboard)` group, so the
 * dashboard boundary never wraps it and a failure here would otherwise hit
 * Next's unstyled built-in screen — which offers a cashier no way back into the
 * app at all.
 *
 * The recovery path matters more here than anywhere else in the app: this is a
 * cashier's own hours, and "try again" plus a link to the register (which needs
 * no attendance query) means a failure to read the DTR never strands someone at
 * the till. The copy is explicit that no punch was changed, because "the page
 * broke" in an attendance context reads as "my hours were lost".
 */
export default function MyActivityError({
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-100">
          <AlertTriangle className="h-6 w-6 text-rose-600" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-bold tracking-tight text-slate-900">
          Your hours could not be loaded
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Nothing was changed — your punches are still recorded exactly as you
          left them. Try again, or head back to the register.
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
            href="/pos"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Back to register
          </Link>
        </div>
      </div>
    </div>
  );
}