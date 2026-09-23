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
  DRAFT: { label: "Draft", cls: "bg-slate-800 text-slate-300" },
  ORDERED: { label: "Ordered", cls: "bg-indigo-500/15 text-indigo-300" },
  PARTIALLY_RECEIVED: {
    label: "Partially received",
    cls: "bg-amber-500/15 text-amber-300",
  },
  RECEIVED: { label: "Received", cls: "bg-emerald-500/15 text-emerald-300" },
  CANCELLED: { label: "Cancelled", cls: "bg-red-500/15 text-red-300" },
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
