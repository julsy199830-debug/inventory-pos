"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  ShoppingBasket,
  Users,
  UserCog,
  Calculator,
  BarChart3,
  PieChart,
  Settings,
  Tags,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { lockRegister } from "@/lib/actions/auth-actions";
import type { Role } from "@/lib/types";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  section: "management" | "reports" | "system";
};

const sectionDefs: { key: NavItem["section"]; title: string }[] = [
  { key: "management", title: "Management" },
  { key: "reports", title: "Reports & Sales" },
  { key: "system", title: "System" },
];

const navItems: NavItem[] = [
  // MANAGEMENT
  { label: "Dashboard", href: "/", icon: LayoutDashboard, section: "management" },
  { label: "Inventory", href: "/inventory", icon: Package, section: "management" },
  { label: "Categories", href: "/inventory/categories", icon: Tags, section: "management" },
    { label: "Suppliers", href: "/suppliers", icon: Truck, section: "management" },
  { label: "Purchasing", href: "/purchasing", icon: ShoppingBasket, section: "management" },
  { label: "Customers", href: "/customers", icon: Users, section: "management" },
  {
    label: "Employees",
    href: "/employees",
    icon: UserCog,
    adminOnly: true,
    section: "management",
  },
  // REPORTS & SALES
  { label: "Reports", href: "/reports", icon: BarChart3, section: "reports" },
  {
    label: "Analytics",
    href: "/reports/analytics",
    icon: PieChart,
    section: "reports",
  },
  {
    label: "Accounting",
    href: "/accounting",
    icon: Calculator,
    adminOnly: true,
    section: "reports",
  },
  // SYSTEM
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    adminOnly: true,
    section: "system",
  },
];

export default function Sidebar({
  user,
}: {
  user: { name: string; role: Role };
}) {
  const pathname = usePathname();
  const isAdmin = user.role === "ADMIN";

  // Active-link test. `/` is exact-only (otherwise every route "starts with"
  // it). `/inventory` is also exact-only: it now has a dedicated child route
  // (`/inventory/categories`), so a `startsWith` check would highlight both
  // Inventory and Categories when the child is open. `/reports` is exact-only
  // too now that `/reports/analytics` has its own nav item — a `startsWith`
  // check would light up both Reports and Analytics when the latter is open.
  // Every other item falls back to `startsWith`, which matches its own page
  // plus any deeper sub-routes.
  const isActive = (href: string) =>
    href === "/" || href === "/inventory" || href === "/reports"
      ? pathname === href
      : pathname.startsWith(href);

  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      {/* Branding */}
      <div className="mb-4 px-2 text-center">
        <Link href="/" className="block" aria-label="InvPos Home">
          <span className="block text-2xl font-bold tracking-tight text-white">InvPos</span>
        </Link>
      </div>

      {/* Primary action: Point of Sale — the register is the app's core module,
          so it gets a dedicated top-level CTA instead of a plain nav row. `/pos`
          renders outside the (dashboard) layout (no sidebar there), so there's
          no on-route active state to track here. */}
      <div className="mx-4 mb-4">
        <Link
          href="/pos"
          className="group flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-600/30 transition-colors hover:bg-indigo-500"
        >
          <ShoppingCart className="h-5 w-5 shrink-0" />
          Point of Sale
        </Link>
      </div>

      {/* User profile card: avatar, name, role badge */}
      <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white">
          {user.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-slate-100">
            {user.name}
          </p>
          <span className="mt-1 inline-block rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300 ring-1 ring-indigo-500/30">
            {user.role === "ADMIN" ? "Administrator" : "Manager"}
          </span>
        </div>
      </div>

      {/* Sectioned navigation */}
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
        {sectionDefs.map((section) => {
          const items = visibleItems.filter((i) => i.section === section.key);
          if (items.length === 0) return null;
          return (
            <div key={section.key}>
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                {section.title}
              </p>
              <div className="flex flex-col gap-1">
                {items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={[
                        "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-indigo-500/10 font-medium text-indigo-300"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
                      ].join(" ")}
                    >
                      <Icon
                        className={[
                          "h-5 w-5 shrink-0 transition-colors",
                          active
                            ? "text-indigo-300"
                            : "text-slate-500 group-hover:text-slate-200",
                        ].join(" ")}
                      />
                      {item.label}
                      {active && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Sticky register lock */}
      <div className="border-t border-slate-800 px-4 py-4">
        <button
          type="button"
          onClick={() => lockRegister()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
        >
          <Lock className="h-5 w-5 shrink-0 text-slate-500" />
          Lock Register
        </button>
      </div>
    </aside>
  );
}
