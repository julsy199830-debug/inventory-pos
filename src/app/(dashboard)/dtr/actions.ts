"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { type ActionResult } from "@/lib/types";
import { getCashier, roleGuardError } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

/**
 * Manager time-correction actions for the DTR (Phase 5).
 *
 * Separate from `employees/actions.ts` on purpose: that module owns the
 * employee's own punches (clock in/out, breaks) which any cashier can invoke
 * for themselves, while everything here edits ANOTHER person's attendance
 * record and therefore sits behind the ADMIN/MANAGER staff guard. Keeping the
 * gate in one place (the `roleGuardError` check at the top of each action)
 * means a new correction variant can't be added without it.
 */

/** Employee management is restricted to ADMIN and MANAGER at the action layer. */
const STAFF_ROLES = ["ADMIN", "MANAGER"] as const;

/** Which `Shift` column a correction may touch. */
const CORRECTABLE_FIELDS = ["start", "end"] as const;
type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

/**
 * `load` reads a `FormData` field as a string and coerces empty/whitespace to
 * `undefined`, same helper shape as the employees/customers action files.
 */
function load(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (raw == null) return undefined;
  const str = String(raw).trim();
  return str === "" ? undefined : str;
}

/**
 * Result of {@link correctShiftTime}: echoes the shift id so the client row can
 * re-render without waiting on the revalidated page.
 */
export type CorrectShiftResult = ActionResult<{ shiftId?: string }>;

/**
 * Correct a shift's clock-in (`start`) or clock-out (`end`) time.
 *
 * Form-driven payload:
 *   - `shiftId` — the shift being corrected
 *   - `field`   — "start" | "end"
 *   - `value`   — the replacement timestamp, `datetime-local` string or ISO
 *   - `reason`  — REQUIRED justification (rejected below when missing/short)
 *
 * Three writes, in this order:
 *   1. The `Shift` row itself is updated in place — it stays the single source
 *      of truth for time-worked and the clock-out sale snapshots.
 *   2. A `DtrCorrection` row records before/after evidence (structured,
 *      queryable, shown on the DTR page).
 *   3. An `AuditLog` row under `DTR_CORRECTION`/EMPLOYEES so the change also
 *      surfaces in the existing audit UI (human narrative, not structured).
 *
 * The reason is the crux: a correction that can't say why is just a silent
 * rewrite of someone's attendance, so it is validated server-side (trimmed,
 * minimum length) before ANY write happens.
 */
export async function correctShiftTime(formData: FormData): Promise<CorrectShiftResult> {
  const denied = await roleGuardError(STAFF_ROLES);
  if (denied) return { ok: false, error: denied };

  const shiftId = load(formData, "shiftId");
  const fieldRaw = load(formData, "field");
  const valueRaw = load(formData, "value");
  const reason = load(formData, "reason");

  if (!shiftId || !fieldRaw || !valueRaw) {
    return { ok: false, error: "Missing correction details. Refresh and try again." };
  }
  if (!reason || reason.length < 4) {
    return {
      ok: false,
      error: "A reason of at least 4 characters is required to correct a time punch.",
    };
  }
  if (!CORRECTABLE_FIELDS.includes(fieldRaw as CorrectableField)) {
    return { ok: false, error: "Only the clock-in and clock-out times can be corrected." };
  }
  const field = fieldRaw as CorrectableField;

  // `datetime-local` gives "YYYY-MM-DDTHH:MM" (local wall time, no zone).
  // Node parses that as local time; the value must be a real date —
  // `new Date("garbage")` yields an Invalid Date whose `toISOString` would
  // throw, so we gate on `Number.isNaN(getTime())` before any write.
  const after = new Date(valueRaw);
  if (Number.isNaN(after.getTime())) {
    return { ok: false, error: "That timestamp isn't a valid date." };
  }

  const actor = await getCashier();

  // Read BEFORE the update: the correction row must capture the value being
  // replaced, not the value we just wrote.
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, userId: true, start: true, end: true },
  });
  if (!shift) {
    return { ok: false, error: "This shift no longer exists. Refresh and try again." };
  }
  const before = field === "start" ? shift.start : shift.end;
  if (before && before.getTime() === after.getTime()) {
    return { ok: false, error: "That is already the recorded time — nothing to correct." };
  }

  const subject = await prisma.user.findUnique({
    where: { id: shift.userId },
    select: { name: true },
  });

  try {
    await prisma.shift.update({
      where: { id: shiftId },
      data: field === "start" ? { start: after } : { end: after },
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return { ok: false, error: "This shift no longer exists. Refresh and try again." };
    }
    throw err;
  }

  await prisma.dtrCorrection.create({
    data: {
      shiftId,
      userId: shift.userId,
      field,
      before,
      after,
      reason,
      correctedById: actor?.id ?? null,
      correctedByName: actor?.name ?? null,
    },
  });

  revalidatePath("/dtr");
  revalidatePath("/employees");
  revalidatePath("/my-activity");

  // Deliberately AFTER the business writes (see `audit.ts` file header): a
  // failed audit row must never roll back a correction the manager made.
  await recordAudit({
    action: "DTR_CORRECTION",
    userId: actor?.id ?? null,
    actor: actor?.name ?? null,
    entity: "Shift",
    entityId: shiftId,
    summary: `Corrected ${field === "start" ? "clock-in" : "clock-out"} for ${subject?.name ?? "employee"}: ${
      before ? before.toISOString() : "unset"
    } → ${after.toISOString()} (${reason})`,
    before: { [field]: before ?? null, reason: null },
    after: { [field]: after, reason },
  });

  return { ok: true, shiftId };
}
