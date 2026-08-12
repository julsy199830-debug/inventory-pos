"use client";

import { useState } from "react";
import type { StockStatus } from "@/lib/types";

/**
 * Alert banner surfacing products that sit below their low-stock threshold.
 *
 * Rendered at the top of the inventory page as a client island: the page (a
 * Server Component) already computes each product's effective threshold and
 * stock status via {@link stockStatusAt}, so it passes the low/out items down
 * as props rather than the banner re-querying Prisma. The component stays
 * purely presentational and dismissible.
 *
 * The banner splits the alert into two groups — Out of Stock (worse) and Low
 * Stock — each listing the offending SKUs so a manager can restock at a
 * glance. `dismissed` is local state only; the banner returns naturally on the
 * next server render once the rows are restocked, and the dismiss affordance
 * simply hides it for the current client session.
 */
export default function LowStockBanner({
  items,
}: {
  /** Low/out-of-stock products, pre-filtered by the server page. */
  items: {
    id: string;
    name: string;
    sku: string;
    stock: number;
    status: StockStatus;
    threshold: number;
  }[];
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || items.length === 0) return null;

  const out = items.filter((item) => item.status === "out");
  const low = items.filter((item) => item.status === "low");

  return (
    <div
      role="alert"
      className="overflow-hidden rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-emerald-50 shadow-sm"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Warning icon */}
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>

        <div className="min-w-0 flex-1 space-y-2.5">
          <p className="text-sm font-semibold text-emerald-900">
            {items.length.toLocaleString()}{" "}
            {items.length === 1 ? "product needs" : "products need"} attention
          </p>

          {out.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-red-700">
                Out of stock
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {out.map((item) => (
                  <li key={item.id}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs text-red-700">
                      <span className="font-medium">{item.name}</span>
                      <span className="font-mono text-red-500">({item.sku})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {low.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                Low on stock — below {low[0].threshold === 1 ? "1 unit" : `${low[0].threshold} units`}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {low.map((item) => (
                  <li key={item.id}>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-2.5 py-0.5 text-xs text-amber-800">
                      <span className="font-medium">{item.name}</span>
                      <span className="font-mono text-amber-600">({item.sku})</span>
                      <span className="text-amber-500">
                        {item.stock.toLocaleString()} left
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Dismiss button */}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-emerald-400 transition-colors hover:bg-emerald-100 hover:text-emerald-600"
          aria-label="Dismiss low-stock alert"
        >
          <svg
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}