"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const labelByPath: Record<string, string> = {
  "/inventory": "Inventory",
  "/inventory/categories": "Categories",
  "/reports": "Reports",
  "/customers": "Customers",
  "/suppliers": "Suppliers",
  "/employees": "Employees",
  "/accounting": "Accounting",
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
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-2">
          {i > 0 && (
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden />
          )}
          {c.current ? (
            <span className="font-semibold text-slate-900">{c.label}</span>
          ) : (
            <Link
              href={c.href}
              className="font-medium text-slate-500 transition-colors hover:text-blue-600"
            >
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}