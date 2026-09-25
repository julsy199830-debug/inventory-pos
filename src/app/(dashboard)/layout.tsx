import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageAuth } from "@/lib/session";
import Sidebar from "./_components/Sidebar";
import Breadcrumbs from "./_components/Breadcrumbs";
import { PageTransition } from "@/app/_components/ui/PageTransition";
import { stockStatusAt, lowStockThresholdFor } from "@/lib/types";
import { prisma } from "@/lib/db";
import InventoryAssistant from "./_components/InventoryAssistant";

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

  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      category: { select: { lowStockThreshold: true } },
    },
  });
  const inventoryAlerts = products.flatMap((product) => {
    const threshold = lowStockThresholdFor(product.category?.lowStockThreshold);
    const status = stockStatusAt(product.stock, product.category?.lowStockThreshold);
    return status === "ok"
      ? []
      : [{ id: product.id, name: product.name, sku: product.sku, stock: product.stock, threshold, status }];
  });

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      <Sidebar user={user} />
      <main className="h-screen min-w-0 flex-1 overflow-y-auto scroll-smooth">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-xs font-bold text-white">IP</span>
              <span>
                <span className="block text-base font-bold text-slate-900">InvPos</span>
                <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">Inventory & Sales</span>
              </span>
            </Link>
            <Link href="/pos" className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm">Point of Sale</Link>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto pb-0.5" aria-label="Mobile dashboard navigation">
            {[
              ["Dashboard", "/"],
              ["Inventory", "/inventory"],
              ["Purchasing", "/purchasing"],
              ["Reports", "/reports"],
              ["Customers", "/customers"],
            ].map(([label, href]) => (
              <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-indigo-700">
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8 xl:px-10">
          <Breadcrumbs />
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
      <InventoryAssistant alerts={inventoryAlerts} />
    </div>
  );
}
