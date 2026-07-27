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
  Settings,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Inventory", href: "/inventory", icon: Package },
  { label: "Point of Sale", href: "/pos", icon: ShoppingCart },
  { label: "Suppliers", href: "/suppliers", icon: Truck },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Employees", href: "/employees", icon: UserCog },
  { label: "Accounting", href: "/accounting", icon: Calculator },
  { label: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-zinc-200 bg-white">
      {/* Branding */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-base font-semibold tracking-tight text-zinc-900">
            Apex POS
          </p>
          <p className="text-xs font-medium text-zinc-400">
            Inventory & Point of Sale
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-2">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
              ].join(" ")}
            >
              <Icon
                className={[
                  "h-5 w-5 shrink-0 transition-colors",
                  active
                    ? "text-white"
                    : "text-zinc-400 group-hover:text-zinc-900",
                ].join(" ")}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sticky user profile */}
      <div className="border-t border-zinc-200 px-4 py-4">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-700">
            JD
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-zinc-900">
              Jordan Doe
            </p>
            <p className="truncate text-xs text-zinc-400">Store Manager</p>
          </div>
          <Settings className="h-4 w-4 text-zinc-400" />
        </div>
      </div>
    </aside>
  );
}
