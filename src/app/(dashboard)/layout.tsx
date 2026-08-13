import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requirePageAuth } from "@/lib/session";
import Sidebar from "./_components/Sidebar";
import Breadcrumbs from "./_components/Breadcrumbs";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The dashboard is staff-only: every page under this route group (overview,
  // inventory, employees, reports, accounting, settings) requires a signed-in
  // ADMIN/MANAGER. Unknown visitors go to /login; CASHIERs belong on the
  // register, so bounce them to /pos instead of letting them browse management
  // views they can't use.
  const user = await requirePageAuth();
  if (user.role === "CASHIER") redirect("/pos");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      <Sidebar user={user} />
      <main className="min-w-0 flex-1 overflow-y-auto scroll-smooth">
        <div className="mx-auto w-full max-w-7xl px-6 py-8 sm:px-8 lg:px-10">
          <Breadcrumbs />
          {children}
        </div>
      </main>
    </div>
  );
}
