"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const labelByPath: Record<string, string> = {
  "/inventory": "Inventory",
  "/inventory/categories": "Categories",
  "/reports": "Reports",
  "/reports/analytics": "Analytics",
  "/customers": "Customers",
  "/suppliers": "Suppliers",
  "/purchasing": "Purchasing",
  "/employees": "Employees",
  "/dtr": "Time & attendance",
  "/accounting": "Accounting",
  "/audit-log": "Audit log",
  "/settings": "Settings",
};

export default function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { href: string; label: string; current?: boolean }[] = [
    { href: "/", label: "Dashboard" },
  ];
  let acc = "";
  for (const seg of segments) {
    acc += "/" + seg;
    const label = labelByPath[acc];
    if (label) crumbs.push({ href: acc, label });
  }
  crumbs[crumbs.length - 1].current = true;

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-6 flex flex-wrap items-center gap-2 text-sm"
    >
      {crumbs.map((c, i) => {
        // Only the crumb that exactly matches the current path is rendered as
        // plain "current" text. On dynamic routes (e.g. /purchasing/<id>) no
        // crumb matches, so the parent stays a clickable link instead of being
        // wrongly marked as the current page.
        const isCurrent = c.href === pathname;
        return (
          <span key={c.href} className="flex items-center gap-2">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            )}
            {isCurrent ? (
              <span className="font-semibold text-slate-900" aria-current="page">
                {c.label}
              </span>
            ) : (
              <Link
                href={c.href}
                className="font-medium text-slate-500 transition-colors hover:text-indigo-700"
              >
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
