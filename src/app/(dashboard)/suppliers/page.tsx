import { prisma } from "@/lib/db";
import AddSupplierDialog from "./AddSupplierDialog";
import DeleteSupplierButton from "./DeleteSupplierButton";
import SupplierPerformancePanel from "./SupplierPerformancePanel";
import { getSupplierPerformance } from "./supplier-data";
import { getStoreSettings } from "@/app/actions/settings";
import EditSupplierDialog from "./EditSupplierDialog";

type Supplier = {
  id: string;
  name: string;
  // These hold the raw DB values (nullable) — the em-dash you see in the
  // table is a pure view concern rendered at display time, not baked into
  // the data. That way a supplier literally named "—" can't be confused with
  // a blank, and the edit dialog gets "" for empty inputs with no sentinel
  // round-trip.
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Count of products linked to this supplier, for the "Products" column. */
  productCount: number;
};

export default async function SuppliersPage({
  searchParams,
}: {
  // searchParams is a Promise in this Next.js version — see the page file
  // convention docs on handling filtering with searchParams.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Awaited query-string filter: q is the text search. Drawn from the awaited
  // Promise<searchParams> (see the page file convention docs).
  const sp = await searchParams;
  const { q = "" } = sp;
  const [performance, settings] = await Promise.all([
    getSupplierPerformance(sp.range),
    getStoreSettings(),
  ]);
  const currencySymbol = settings?.currencySymbol ?? "P";
  const query = Array.isArray(q) ? q[0] ?? "" : q;
  const term = query.trim().toLowerCase();

  // Fetched in parallel: the list of suppliers (with their linked product
  // counts) and the total supplier count for the header. Both are direct
  // server-side Prisma queries, safe in a Server Component.
  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    }),
    prisma.supplier.count(),
  ]);

  const suppliers: Supplier[] = rows
    .filter((s) => {
      // Server-side filter: match on name, contact name, or email.
      const matchesTerm =
        term === "" ||
        s.name.toLowerCase().includes(term) ||
        (s.contactName?.toLowerCase().includes(term) ?? false) ||
        (s.email?.toLowerCase().includes(term) ?? false);
      return matchesTerm;
    })
    .map((s) => ({
      id: s.id,
      name: s.name,
      // Keep the raw nullable values; the em-dash is rendered at display time
      // (table cells) and the edit form coalesces null → "".
      contactName: s.contactName,
      email: s.email,
      phone: s.phone,
      address: s.address,
      productCount: s._count.products,
    }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Suppliers
          </h1>
          <p className="text-sm text-slate-500">
            Showing{" "}
            <span className="font-medium text-slate-900">
              {suppliers.length.toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="font-medium text-slate-900">
              {total.toLocaleString()}
            </span>{" "}
            suppliers
          </p>
        </div>
      </header>

      {/* Phase 2: the ordering / receiving position. The supplier roster below
          answers "who do we work with"; this answers "what have we committed to
          and what is still outstanding", which is a different question. */}
      <SupplierPerformancePanel
        data={performance}
        currencySymbol={currencySymbol}
        activeRange={Array.isArray(sp.range) ? sp.range[0] : sp.range ?? ""}
      />

      {/* Controls row. The search box is its own GET form so submitting (Enter in
          the search field) updates the URL searchParams, which re-renders this
          Server Component with the filtered rows. The form deliberately wraps
          ONLY the search input: the "Add New Supplier" dialog renders its own
          <form> for the createSupplier Server Action, and nesting a form inside
          a form is invalid HTML that React reports as a hydration error. The
          trigger button therefore sits OUTSIDE the search form, inside the same
          flex row so the layout is unchanged. */}
      <div className="flex flex-wrap items-center gap-3">
        <form className="relative min-w-0 flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3-3" />
          </svg>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search suppliers..."
            className="w-full rounded-xl border border-slate-300 bg-white shadow-sm py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
          />
        </form>

        {/* "Add New Supplier" trigger + modal. Client island (manages open
            state); submits to the createSupplier Server Action, which inserts
            via Prisma and revalidates this page so the new row streams in.
            Kept outside the search form above so its inner <form> is never
            nested inside another form. */}
        <AddSupplierDialog />
      </div>

      {/* Data table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3 font-medium">Supplier Name</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Products</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {suppliers.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                  <td className="px-4 py-3 text-slate-600">{s.contactName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{s.email ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{s.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{s.address ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ProductCountPill count={s.productCount} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <EditSupplierDialog
                        supplier={{
                          // Pass the raw nullable values straight through; the
                          // dialog coalesces null → "" at its input layer and the
                          // em-dash lives only in the table cells above.
                          id: s.id,
                          name: s.name,
                          contactName: s.contactName,
                          email: s.email,
                          phone: s.phone,
                          address: s.address,
                        }}
                      />
                      <DeleteSupplierButton id={s.id} name={s.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {suppliers.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            No suppliers found.
          </div>
        )}
      </div>
    </div>
  );
}

/** Small pill showing how many products are linked to this supplier. */
function ProductCountPill({ count }: { count: number }) {
  const color =
    count === 0
      ? "bg-slate-100 text-slate-600"
      : "bg-indigo-50 text-indigo-700";
  const label = count === 1 ? "1 product" : `${count} products`;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}
