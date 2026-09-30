import Link from "next/link";
import { PackageSearch } from "lucide-react";

/**
 * App-wide 404.
 *
 * Next's built-in "404 | This page could not be found" is a bare black-on-white
 * line with no way back, which reads as a broken build rather than a mistyped
 * URL. This uses the same light card, type scale and indigo link treatment as
 * the rest of the product, and offers the two destinations people actually want
 * from a dead link: the dashboard, and the register.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 ring-1 ring-indigo-100">
          <PackageSearch className="h-6 w-6 text-indigo-600" aria-hidden />
        </div>
        <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wide text-slate-400">
          Error 404
        </p>
        <h1 className="mt-1 text-lg font-bold tracking-tight text-slate-900">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          That address does not match anything in InvPos. It may have been
          renamed, or the link may be out of date.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 active:scale-[0.98]"
          >
            Back to dashboard
          </Link>
          <Link
            href="/pos"
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]"
          >
            Open register
          </Link>
        </div>
      </div>
    </div>
  );
}
