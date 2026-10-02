"use server";

import { redirect } from "next/navigation";
import { clearCashierCookie, getCashier } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

/**
 * Lock the register / switch user: sign out, record it, and return to the login
 * screen. Both "Lock Register" buttons (sidebar + POS header) and "Switch User"
 * funnel through here, so this is the ONE place a sign-out is recorded.
 *
 * It used to be the orphaned `signOutCashier` in `pos/actions.ts`, which nothing
 * called — locking the register cleared the cookie and left no audit trail at
 * all. The action is deleted rather than left as a second, competing way to do
 * the same thing; one funnel means one audit row per real sign-out.
 *
 * Three properties this is ordered for:
 *
 *   - ATTRIBUTION: the actor is resolved BEFORE the cookie is cleared, because
 *     afterwards the id is gone and the event could not be attributed.
 *   - NO DUPLICATES: the cookie is cleared before the audit is written, so a
 *     second (double-click, stale tab, retry) call finds no session and writes
 *     nothing. A lock with no session records nothing, because nothing happened.
 *   - RELIABILITY: the redirect comes last and the audit never blocks it —
 *     `recordAudit` swallows its own failures (see `lib/audit.ts`), so a locked
 *     register is never held up by the audit write.
 */
export async function lockRegister(): Promise<void> {
  const cashier = await getCashier();
  await clearCashierCookie();
  if (cashier) {
    await recordAudit({
      action: "LOGOUT",
      userId: cashier.id,
      actor: cashier.name,
      entity: "User",
      entityId: cashier.id,
    });
  }
  redirect("/login");
}
