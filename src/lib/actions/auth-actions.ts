"use server";

import { redirect } from "next/navigation";
import { clearCashierCookie } from "@/lib/session";

/**
 * Lock the register / switch user: clear the site-wide session cookie and
 * return to the login screen. Both "Lock Register" and "Switch User" funnel
 * through here (clients clear cart state before invoking).
 */
export async function lockRegister(): Promise<void> {
  await clearCashierCookie();
  redirect("/login");
}
