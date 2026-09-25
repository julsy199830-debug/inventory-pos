import type { PoStatus } from "../actions";

/**
 * Display vocabulary for PO statuses.
 *
 * This lives in the UI layer on purpose: `actions.ts` is a `"use server"`
 * module and may only export async functions (plus types), so the display
 * labels/tone map can't be re-exported from there.
 *
 * Phase 1 actively uses DRAFT / ORDERED / CANCELLED. PARTIALLY_RECEIVED and
 * RECEIVED are present so a future receiving phase needs no UI change, but no
 * Phase 1 code path can produce them.
 */
const STATUS_META: Record<PoStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-slate-100 text-slate-700 ring-1 ring-slate-200" },
  ORDERED: { label: "Ordered", cls: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200" },
  PARTIALLY_RECEIVED: {
    label: "Partially received",
    cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  },
  RECEIVED: { label: "Received", cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  CANCELLED: { label: "Cancelled", cls: "bg-red-50 text-red-700 ring-1 ring-red-200" },
};

/** Small pill showing a purchase order's status. */
export default function PoStatusBadge({ status }: { status: PoStatus }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    cls: "bg-slate-800 text-slate-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}
