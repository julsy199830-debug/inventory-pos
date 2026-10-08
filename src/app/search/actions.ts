"use server";

import "server-only";

import { prisma } from "@/lib/db";
import { getCashier } from "@/lib/session";

/**
 * Phase 7 Step 5 — Global Search / Quick Navigation (server side).
 *
 * One role-aware entry point for "find something quickly": page shortcuts the
 * signed-in user may actually open, plus record hits across the existing
 * tables. No second search database — every query below is a bounded Prisma
 * `contains` read against an already-indexed field, run in parallel with a
 * small `take` so one keystroke never becomes five table scans of doom.
 *
 * SECURITY — this action is a read gate, not just a filter:
 *   - anonymous callers get `{ ok: false }` and zero rows,
 *   - a CASHIER only ever sees pages they can open plus the record types the
 *     register already exposes to them (products, customers, their OWN sales).
 *     Purchasing, employees, and management-only pages are never returned —
 *     and the destination routes keep their own server-side guards, so hiding
 *     here is convenience, the route guard is the boundary.
 *   - ADMIN/MANAGER additionally see purchase orders, employees, and the
 *     management page shortcuts they are allowed to open.
 */

export type SearchResultKind =
  | "page"
  | "product"
  | "customer"
  | "sale"
  | "purchase-order"
  | "employee";

/** One navigable hit. `href` is always an existing route — never a new page. */
export type SearchHit = {
  kind: SearchResultKind;
  /** Primary line, e.g. "Maria Santos" or "PO-202609-000001". */
  title: string;
  /** Secondary line, e.g. "ELEC-0001 · 42 in stock" or "Walk-in · Completed". */
  detail: string;
  /** Where Enter/click takes the user. */
  href: string;
};

/** Grouped hits, in the order the dialog renders them. */
export type SearchGroups = {
  pages: SearchHit[];
  products: SearchHit[];
  customers: SearchHit[];
  sales: SearchHit[];
  purchaseOrders: SearchHit[];
  employees: SearchHit[];
};

export type GlobalSearchResult =
  | { ok: true; data: SearchGroups }
  | { ok: false; error: string };

/** Per-type cap: keeps the dialog scannable and each query cheap. */
const LIMIT = 5;

/** Minimum characters before record queries run (pages always match). */
const MIN_QUERY = 2;

/** Max characters accepted — longer input cannot match anything useful. */
const MAX_QUERY = 80;

type PageDef = {
  title: string;
  detail: string;
  href: string;
  /** Extra words users type when they can't remember the menu label. */
  keywords: string;
  staffOnly?: boolean;
};

/**
 * Every destination the search can offer, in plain staff words.
 * Hrefs are existing routes only — several brief items ("Receiving",
 * "Sales History", "Stock Count") live INSIDE another screen, so they point
 * at that screen rather than a duplicate page.
 */
const PAGES: PageDef[] = [
  { title: "Point of Sale", detail: "Open the register", href: "/pos", keywords: "pos register till checkout sell ring up" },
  { title: "Dashboard", detail: "Today at a glance", href: "/", keywords: "dashboard home overview start today" },
  { title: "My Transactions", detail: "Sales I rang up", href: "/my-transactions", keywords: "my transactions sales history mine receipt reprint" },
  { title: "My Hours", detail: "My attendance", href: "/my-activity", keywords: "my hours activity attendance clock shift break" },
  { title: "Products & Stock", detail: "Inventory list", href: "/inventory", keywords: "products product inventory stock catalog items sku" },
  { title: "Stock Count", detail: "Count what's on the shelves", href: "/inventory", keywords: "stock count physical count shelves variance" },
  { title: "Categories", detail: "Product categories", href: "/inventory/categories", keywords: "categories category groups types", staffOnly: true },
  { title: "Customers", detail: "Customer list & accounts", href: "/customers", keywords: "customers customer clients accounts people buyers", staffOnly: true },
  { title: "Purchase Orders", detail: "Orders to suppliers", href: "/purchasing", keywords: "purchase orders purchasing po suppliers orders buying", staffOnly: true },
  { title: "Receiving", detail: "Receive stock against an order", href: "/purchasing", keywords: "receiving receive delivery stock in goods receipt", staffOnly: true },
  { title: "Suppliers", detail: "Vendor list", href: "/suppliers", keywords: "suppliers supplier vendors", staffOnly: true },
  { title: "Employees", detail: "Staff list & shifts", href: "/employees", keywords: "employees employee staff team users cashiers", staffOnly: true },
  { title: "Time & Attendance", detail: "Daily time record", href: "/dtr", keywords: "dtr time attendance clock timesheet hours shifts", staffOnly: true },
  { title: "Sales Reports", detail: "Sales, exports & analytics", href: "/reports", keywords: "reports sales reports export analytics history all sales", staffOnly: true },
  { title: "Accounting", detail: "Money in & out", href: "/accounting", keywords: "accounting money finance ledger profit", staffOnly: true },
  { title: "Audit Log", detail: "Who changed what", href: "/audit-log", keywords: "audit log history changes who", staffOnly: true },
  { title: "Store Settings", detail: "Name, tax & currency", href: "/settings", keywords: "settings store settings tax currency name receipt", staffOnly: true },
];

/** Short transaction number shown across the app: first 8 id chars, uppercased. */
function txnNumber(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

const EMPTY: SearchGroups = {
  pages: [],
  products: [],
  customers: [],
  sales: [],
  purchaseOrders: [],
  employees: [],
};

/**
 * Search pages + records the caller may see.
 *
 * Page shortcuts match from the first character (empty query lists the most
 * useful ones); record queries need 2+ characters and run in parallel with a
 * per-type cap. Role scoping happens BEFORE querying: a cashier's promise set
 * never includes purchasing/employees/management reads at all.
 */
export async function globalSearch(rawQuery: string): Promise<GlobalSearchResult> {
  const user = await getCashier();
  if (!user) return { ok: false, error: "Sign in to search." };

  const query = (rawQuery ?? "").trim().slice(0, MAX_QUERY);
  const q = query.toLowerCase();
  const staff = user.role === "ADMIN" || user.role === "MANAGER";

  // ── Pages: pure in-memory filter, always available ────────────────────────
  const pagePool = PAGES.filter((p) => staff || !p.staffOnly);
  const pages: SearchHit[] = pagePool
    .filter((p) =>
      q === "" ? true : `${p.title} ${p.detail} ${p.keywords}`.toLowerCase().includes(q),
    )
    .slice(0, q === "" ? 6 : LIMIT)
    .map((p) => ({ kind: "page" as const, title: p.title, detail: p.detail, href: p.href }));

  // An empty query is the "initial state": shortcuts only, no DB reads at all.
  if (q.length < MIN_QUERY) {
    return { ok: true, data: { ...EMPTY, pages } };
  }

  // ── Records: parallel, bounded, role-scoped reads ─────────────────────────
  // Products & customers: every signed-in role already reads these (the
  // register loads both), so all roles may search them.
  const productPromise = prisma.product.findMany({
    where: { OR: [{ name: { contains: query } }, { sku: { contains: query } }] },
    orderBy: { name: "asc" },
    take: LIMIT,
    select: { id: true, name: true, sku: true, price: true, stock: true },
  });
  const customerPromise = prisma.customer.findMany({
    where: {
      OR: [{ name: { contains: query } }, { phone: { contains: query } }, { email: { contains: query } }],
    },
    orderBy: { name: "asc" },
    take: LIMIT,
    select: { id: true, name: true, phone: true },
  });
  // Sales: staff see any recent sale; a CASHIER only sees their OWN rows
  // (`cashierId` from the session, never from the client — same scoping rule
  // as `/my-transactions`). Destination differs per role too (below).
  const salePromise = prisma.sale.findMany({
    where: {
      ...(staff ? {} : { cashierId: user.id }),
      OR: [
        { id: { contains: query } },
        { customer: { name: { contains: query } } },
        ...(staff ? [{ cashier: { name: { contains: query } } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      paymentMethod: true,
      status: true,
      customer: { select: { name: true } },
    },
  });
  // Purchasing + employees: staff-only reads, never issued for a cashier.
  const poPromise = staff
    ? prisma.purchaseOrder.findMany({
        where: {
          OR: [{ poNumber: { contains: query } }, { supplier: { name: { contains: query } } }],
        },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          poNumber: true,
          status: true,
          supplier: { select: { name: true } },
        },
      })
    : Promise.resolve([]);
  const employeePromise = staff
    ? prisma.user.findMany({
        where: {
          OR: [{ name: { contains: query } }, { email: { contains: query } }],
        },
        orderBy: { name: "asc" },
        take: LIMIT,
        select: { id: true, name: true, role: true, active: true },
      })
    : Promise.resolve([]);

  const [products, customers, sales, orders, employees] = await Promise.all([
    productPromise,
    customerPromise,
    salePromise,
    poPromise,
    employeePromise,
  ]);

  return {
    ok: true,
    data: {
      pages,
      products: products.map((p) => ({
        kind: "product" as const,
        title: p.name,
        detail: `${p.sku} · ${p.stock} in stock`,
        // Products live on the inventory list (no per-product route exists);
        // `q` is the list's own text-search param, so the row is found on load.
        href: `/inventory?q=${encodeURIComponent(p.sku)}`,
      })),
      customers: customers.map((c) => ({
        kind: "customer" as const,
        title: c.name,
        detail: c.phone ?? "No phone on file",
        href: `/customers/${c.id}`,
      })),
      sales: sales.map((s) => ({
        kind: "sale" as const,
        title: `Sale ${txnNumber(s.id)}`,
        detail: `${s.customer?.name ?? "Walk-in"} · ${s.status}`,
        // Staff open the register's history view; a cashier opens their OWN
        // sale receipt — the two detail surfaces the app already has.
        href: staff ? "/pos" : `/my-transactions/${s.id}`,
      })),
      purchaseOrders: orders.map((o) => ({
        kind: "purchase-order" as const,
        title: o.poNumber,
        detail: `${o.supplier?.name ?? "Unknown supplier"} · ${o.status}`,
        href: `/purchasing/${o.id}`,
      })),
      employees: employees.map((e) => ({
        kind: "employee" as const,
        title: e.name,
        detail: `${e.role}${e.active ? "" : " · inactive"}`,
        href: "/employees",
      })),
    },
  };
}

