"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Date-range preset selector for the Accounting page.
 *
 * The presets encode a fixed window relative to "now": Today, last 7 days
 * (7D), and last 30 days (30D). "Custom" is a placeholder for a future
 * date-picker and currently behaves like 30D — but it still sets ?range=custom
 * so the URL state is meaningful once the picker lands.
 *
 * Selection is driven entirely through the URL: clicking a preset calls
 * `router.replace` with a fresh `?range=<preset>` so the Server Component
 * re-fetches the financial summary for the new window. We deliberately do NOT
 * call `useSearchParams` here — doing so during a production prerender bails the
 * route to client-side rendering and requires a Suspense boundary. Instead the
 * server passes the currently-active preset as `active` (read from the awaited
 * `searchParams` prop on the page), exactly mirroring how `CategoryFilter`
 * gets its selected value. That keeps the whole page statically prerenderable
 * while the selector remains a tiny, stateless navigation trigger.
 */
type RangePreset = "today" | "7d" | "30d" | "custom";

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];

export default function RangeSelector({ active }: { active: RangePreset }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      className="inline-flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white shadow-sm p-1"
      role="group"
      aria-label="Date range"
    >
      {PRESETS.map((preset) => {
        const isActive = preset.value === active;
        return (
          <button
            key={preset.value}
            type="button"
            disabled={pending}
            aria-pressed={isActive}
            onClick={() => {
              // `router.replace` (not push) so flitting between presets doesn't
              // pollute the browser history — each selection replaces the last,
              // leaving a single back step to leave the accounting page entirely.
              startTransition(() => router.replace(`/accounting?range=${preset.value}`));
            }}
            className={[
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-60",
              isActive
                ? "bg-indigo-600 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            ].join(" ")}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
