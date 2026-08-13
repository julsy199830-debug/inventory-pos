"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
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
import Image from "next/image";
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
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-200/80 bg-white">
      {/* Branding */}
      <div className="flex items-center gap-3 px-6 pb-5 pt-6">
        <Image
          src="/logo.png"
          alt="JuLs POS SYSTEM"
          width={40}
          height={40}
          className="h-10 w-10 rounded-xl object-cover"
        />
        <div className="leading-tight">
          <p className="text-base font-semibold tracking-tight text-slate-900">
            JuLs POS SYSTEM
          </p>
          <p className="text-xs font-medium text-slate-400">
            Inventory & Point of Sale
          </p>
        </div>
      </div>

      {/* Primary action: Point of Sale — the register is the app's core module,
          so it gets a dedicated top-level CTA instead of a plain nav row. `/pos`
          renders outside the (dashboard) layout (no sidebar there), so there's
          no on-route active state to track here. */}
      <div className="mx-4 mb-4">
        <Link
          href="/pos"
          className="group flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-600/25 transition-colors hover:bg-blue-700"
        >
          <ShoppingCart className="h-5 w-5 shrink-0" />
          Point of Sale
        </Link>
      </div>

      {/* User profile card: avatar, name, role badge */}
      <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
          {user.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-slate-900">
            {user.name}
          </p>
          <span className="mt-1 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 ring-1 ring-blue-100">
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
                          ? "bg-blue-50 font-medium text-blue-600"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                      ].join(" ")}
                    >
                      <Icon
                        className={[
                          "h-5 w-5 shrink-0 transition-colors",
                          active
                            ? "text-blue-600"
                            : "text-slate-400 group-hover:text-slate-900",
                        ].join(" ")}
                      />
                      {item.label}
                      {active && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-600" />
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
      <div className="border-t border-slate-200/80 px-4 py-4">
        <button
          type="button"
          onClick={() => lockRegister()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <Lock className="h-5 w-5 shrink-0 text-slate-400" />
          Lock Register
        </button>
      </div>
    </aside>
  );
}
