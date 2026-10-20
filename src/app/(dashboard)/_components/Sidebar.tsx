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
  ScrollText,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { lockRegister } from "@/lib/actions/auth-actions";
import type { Role } from "@/lib/types";
import { GlobalSearch } from "@/app/search/GlobalSearch";
import { buttonCls } from "@/app/_components/ui/Button";

/**
 * Phase 7 — navigation reorganised around how an employee actually thinks.
 *
 * The audit found the sidebar showing LESS than the server permits: every guard
 * in this app is `STAFF_ROLES = ["ADMIN", "MANAGER"]`, yet five pages were
 * flagged `adminOnly` and hidden from managers. Employees could reach Employees,
 * DTR, Accounting, Audit Log and Settings — and act on them — but were shown a
 * smaller menu. The nav rule and the server rule now agree: `managerVisible`
 * means "anyone but a CASHIER", which is exactly what the layout and the guards
 * enforce.
 *
 * These groups deliberately map onto EXISTING screens only. Several labels in
 * the Phase 7 brief ("Stock Count", "Receiving", "Loyalty", "Sales History") are
 * features that already exist but live inside another screen rather than on
 * their own route — building separate pages for them would duplicate
 * functionality. See the "Where things are" guide in `nav-guide.tsx` for how to
 * reach them.
 */
type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Hidden from CASHIERs. Named for what it means rather than "adminOnly",
   * because the distinction that actually exists in this codebase is
   * staff-vs-cashier, not admin-vs-manager.
   */
  managerVisible?: boolean;
  section: NavSection;
};

type NavSection = "home" | "sales" | "inventory" | "purchasing" | "customers" | "people" | "reports" | "settings";

const sectionDefs: { key: NavSection; title: string }[] = [
  { key: "home", title: "Home" },
  { key: "sales", title: "Sales" },
  { key: "inventory", title: "Inventory" },
  { key: "purchasing", title: "Purchasing" },
  { key: "customers", title: "Customers" },
  { key: "people", title: "Employees" },
  { key: "reports", title: "Reports" },
  { key: "settings", title: "Settings" },
];

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, section: "home" },

  // SALES — the register is the core module, so Point of Sale leads the group
  // even though it renders outside this layout (the till has no sidebar).
  { label: "Point of Sale", href: "/pos", icon: ShoppingCart, section: "sales" },
  { label: "My Transactions", href: "/my-transactions", icon: ScrollText, section: "sales" },

  // INVENTORY — "/inventory" is the products list; Stock Count lives on that
  // same page as an action, so it is surfaced there rather than as a dead link.
  { label: "Products & Stock", href: "/inventory", icon: Package, section: "inventory" },
  { label: "Categories", href: "/inventory/categories", icon: Tags, section: "inventory" },

  { label: "Suppliers", href: "/suppliers", icon: Truck, section: "purchasing" },
  { label: "Purchase Orders", href: "/purchasing", icon: ShoppingBasket, section: "purchasing" },

  { label: "Customers", href: "/customers", icon: Users, section: "customers" },

  { label: "Employees", href: "/employees", icon: UserCog, managerVisible: true, section: "people" },
  { label: "Time & Attendance", href: "/dtr", icon: ScrollText, managerVisible: true, section: "people" },

  { label: "Sales Reports", href: "/reports", icon: BarChart3, section: "reports" },
  { label: "Analytics", href: "/reports/analytics", icon: PieChart, section: "reports" },
  { label: "Accounting", href: "/accounting", icon: Calculator, managerVisible: true, section: "reports" },
  { label: "Audit Log", href: "/audit-log", icon: ScrollText, managerVisible: true, section: "reports" },

  { label: "Store Settings", href: "/settings", icon: Settings, managerVisible: true, section: "settings" },
];

export default function Sidebar({
  user,
}: {
  user: { name: string; role: Role };
}) {
  const pathname = usePathname();
  // Phase 7: a CASHIER is the only role this menu hides things from. The
  // (dashboard) layout already redirects CASHIERs to /pos, and every mutating
  // guard is `STAFF_ROLES = ["ADMIN", "MANAGER"]` — so "is not a cashier" is
  // exactly the set of people the rest of the app actually permits. The previous
  // `role === "ADMIN"` test hid five pages from managers that the server allows.
  const isCashier = user.role === "CASHIER";

  // Active-link test. `/` is exact-only (otherwise every route "starts with"
  // it). `/inventory` and `/reports` are also exact-only: each now has a
  // dedicated child route, so a `startsWith` check would light up both parent
  // and child when the child is open. Everything else falls back to
  // `startsWith`, which matches its own page plus deeper sub-routes.
  const isActive = (href: string) =>
    href === "/" || href === "/inventory" || href === "/reports"
      ? pathname === href
      : pathname.startsWith(href);

  const visibleItems = navItems.filter((item) => !item.managerVisible || !isCashier);

  return (
    <aside className="hidden h-screen w-68 shrink-0 self-start flex-col border-r border-slate-200 bg-white lg:flex xl:w-72">
      {/* Branding */}
      <div className="mb-4 flex items-center px-3">
        <Link
          href="/"
          className="group flex w-full items-center gap-3 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-slate-50"
          aria-label="InvPos Home"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-bold tracking-tight text-white shadow-md shadow-indigo-600/20">
            IP
          </span>
          <span className="min-w-0 leading-none">
            <span className="block truncate text-base font-bold tracking-tight text-slate-900">InvPos</span>
            <span className="mt-1 block truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Inventory &amp; Sales</span>
          </span>
        </Link>
      </div>

      {/* Primary action: Point of Sale — the register is the app's core module,
          so it gets a dedicated top-level CTA instead of a plain nav row. `/pos`
          renders outside the (dashboard) layout (no sidebar there), so there's
          no on-route active state to track here. */}
      <div className="mx-4 mb-4">
        <Link href="/pos" className={`${buttonCls("primary", "md")} w-full py-3`}>
          <ShoppingCart className="h-5 w-5 shrink-0" />
          Point of Sale
        </Link>
      </div>

      {/* User profile card: avatar, name, role badge */}
      <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-3 py-3 shadow-sm backdrop-blur-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white shadow-sm">
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
          <span className="mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-200">
            {user.role === "ADMIN" ? "Administrator" : "Manager"}
          </span>
        </div>
      </div>

      {/* Search — Step 5: one box to find products, customers, sales, or pages.
          Placed above the nav so it is the first control after the brand. */}
      <div className="px-4 pt-3">
        <GlobalSearch />
      </div>

      {/* Sectioned navigation */}
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
        {sectionDefs.map((section) => {
          const items = visibleItems.filter((i) => i.section === section.key);
          if (items.length === 0) return null;
          return (
            <div key={section.key}>
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
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
                      aria-current={active ? "page" : undefined}
                      className={[
                        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-indigo-50 font-semibold text-indigo-700"
                          : "font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                      ].join(" ")}
                    >
                      <Icon
                        className={[
                          "h-5 w-5 shrink-0 transition-colors",
                          active
                            ? "text-indigo-600"
                            : "text-slate-500 group-hover:text-slate-700",
                        ].join(" ")}
                      />
                      {item.label}
                      {active && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-500" aria-hidden />
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
      <div className="border-t border-slate-200 px-4 py-4">
        <button
          type="button"
          onClick={() => lockRegister()}
          className={`${buttonCls("ghost", "md")} w-full justify-start gap-3`}
        >
          <Lock className="h-5 w-5 shrink-0 text-slate-500" />
          Lock Register
        </button>
      </div>
    </aside>
  );
}
