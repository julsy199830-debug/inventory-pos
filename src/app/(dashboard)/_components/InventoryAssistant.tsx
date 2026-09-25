"use client";

import Link from "next/link";
import { useState } from "react";
import type { StockStatus } from "@/lib/types";

type InventoryAlert = {
  id: string;
  name: string;
  sku: string;
  stock: number;
  threshold: number;
  status: Extract<StockStatus, "low" | "out">;
};

export default function InventoryAssistant({
  alerts,
}: {
  alerts: InventoryAlert[];
}) {
  const [open, setOpen] = useState(false);
  const outOfStock = alerts.filter((alert) => alert.status === "out");
  const lowStock = alerts.filter((alert) => alert.status === "low");
  const totalAlerts = alerts.length;

  return (
    <div className="fixed bottom-3 right-3 z-40 sm:bottom-5 sm:right-5">
      {open && (
        <section
          role="dialog"
          aria-label="Inventory Assistant"
          className="mb-3 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/15"
        >
          <div className="flex items-start gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-base" aria-hidden>
              🤖
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-slate-900">Inventory Assistant</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {totalAlerts === 0
                  ? "Everything is in good shape."
                  : `${totalAlerts} product${totalAlerts === 1 ? "" : "s"} need attention.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close inventory assistant"
            >
              <span aria-hidden>×</span>
            </button>
          </div>

          <div className="space-y-2 p-4 text-sm">
            {totalAlerts === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-800">
                <p className="font-medium">✓ Inventory looks good.</p>
                <p className="mt-0.5 text-xs">No urgent stock alerts.</p>
              </div>
            ) : (
              <>
                {outOfStock.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-red-800">
                    <p className="font-medium">▣ {outOfStock.length} out of stock</p>
                    <p className="mt-0.5 truncate text-xs">
                      {outOfStock.map((item) => item.name).join(", ")}
                    </p>
                  </div>
                )}
                {lowStock.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800">
                    <p className="font-medium">△ {lowStock.length} running low</p>
                    <p className="mt-0.5 truncate text-xs">
                      {lowStock.map((item) => item.name).join(", ")}
                    </p>
                  </div>
                )}
                <Link
                  href="/inventory"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
                >
                  View Inventory
                </Link>
              </>
            )}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close inventory assistant" : "Open inventory assistant"}
        className="relative ml-auto flex h-12 w-12 items-center justify-center rounded-full border border-indigo-200 bg-white text-xl shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
      >
        <span aria-hidden>{open ? "×" : "🤖"}</span>
        {totalAlerts > 0 && !open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {totalAlerts}
          </span>
        )}
      </button>
    </div>
  );
}
