// Seed the `Product` and `Supplier` tables with a realistic starting
// inventory, and link each product to the supplier that provides it.
//
// Run directly:
//   npx tsx prisma/seed.ts
// …or through Prisma (after wiring `prisma.seed`):
//   npx prisma db seed
//
// Idempotent: products are upserted by SKU and suppliers by name, so re-running
// won't duplicate rows or trip unique constraints. On insert, `id`/`createdAt`/
// `updatedAt` are left to their schema defaults; on update, only the supplied
// fields are refreshed (the id and createdAt stay put). The product↔supplier
// link is re-applied on every run by matching SKU → supplier name, so editing
// the `supplierFor` mapping below and re-seeding will rebind products without
// orphaning them.
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/** One row per physical product we stock. `cost` < `price` (intended margin),
 *  SKUs follow `<CAT>-####` so they sort and read well. `supplier` (optional)
 *  is the supplier name to link this product to; omitted products remain un
 *  supplied to honor the optional Product↔Supplier relation. */
type SeedProduct = {
  name: string;
  sku: string;
  price: number;
  cost: number;
  stock: number;
  category: string;
  supplier?: string;
};

/** One row per vendor that supplies us. `name` is the idempotency key (matched
 *  case-sensitively); contact fields are optional to match the schema. */
type SeedSupplier = {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
};

const suppliers: SeedSupplier[] = [
  {
    name: "Northwind Electronics Co.",
    contactName: "Ava Lindqvist",
    email: "ava@northwind-elec.example",
    phone: "+1-555-0142",
    address: "1420 Circuit Ave, San Jose, CA",
  },
  {
    name: "Summit Apparel Group",
    contactName: "Devon Park",
    email: "devon@summitapparel.example",
    phone: "+1-555-0177",
    address: "88 Loomis St, Portland, OR",
  },
  {
    name: "Highland Pantry Imports",
    contactName: "Mira Okafor",
    email: "mira@highlandpantry.example",
    phone: "+1-555-0198",
    address: "7 Cooperage Row, Burlington, VT",
  },
];

const products: SeedProduct[] = [
  // ── Electronics ──────────────────────────────────────────────
  {
    name: "Aurora Wireless Headphones",
    sku: "ELEC-0001",
    price: 129.99,
    cost: 74.5,
    stock: 42,
    category: "Electronics",
    supplier: "Northwind Electronics Co.",
  },
  {
    name: "Nimbus Bluetooth Speaker",
    sku: "ELEC-0002",
    price: 59.99,
    cost: 31.0,
    stock: 75,
    category: "Electronics",
    supplier: "Northwind Electronics Co.",
  },
  {
    name: "PulseFit Smart Watch",
    sku: "ELEC-0003",
    price: 199.99,
    cost: 118.0,
    stock: 18,
    category: "Electronics",
    supplier: "Northwind Electronics Co.",
  },
  // ── Apparel ─────────────────────────────────────────────────
  {
    name: "Trailblaze Cotton Tee",
    sku: "APPR-0001",
    price: 24.99,
    cost: 9.25,
    stock: 210,
    category: "Apparel",
    supplier: "Summit Apparel Group",
  },
  {
    name: "StormProof Rain Jacket",
    sku: "APPR-0002",
    price: 89.99,
    cost: 47.75,
    stock: 33,
    category: "Apparel",
    supplier: "Summit Apparel Group",
  },
  {
    name: "CloudStep Running Socks (3-pack)",
    sku: "APPR-0003",
    price: 18.0,
    cost: 6.4,
    stock: 150,
    category: "Apparel",
    supplier: "Summit Apparel Group",
  },
  // ── Food/Beverage ──────────────────────────────────────────
  {
    name: "Golden Summit Coffee Beans 1lb",
    sku: "FNBV-0001",
    price: 17.5,
    cost: 7.8,
    stock: 95,
    category: "Food/Beverage",
    supplier: "Highland Pantry Imports",
  },
  {
    name: "Highland Spring Sparkling Water 12pk",
    sku: "FNBV-0002",
    price: 14.0,
    cost: 5.6,
    stock: 60,
    category: "Food/Beverage",
    supplier: "Highland Pantry Imports",
  },
  {
    name: "Dark Forest Artisan Chocolate Bar",
    sku: "FNBV-0003",
    price: 6.25,
    cost: 2.1,
    stock: 240,
    category: "Food/Beverage",
    supplier: "Highland Pantry Imports",
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });

  try {
    // Upsert each product by SKU. (createMany would be faster, but Prisma's
    // createMany has no per-row update-on-conflict for SQLite, and upsert
    // keeps re-runs safe.)
    let created = 0;
    let updated = 0;

    // Upsert suppliers first by name so their ids exist before we link
    // products to them. `name` isn't `@unique` in the schema, so we findFirst
    // by name and reuse the existing id on re-runs; on a true insert the
    // schema defaults assign id/createdAt/updatedAt. We carry only the contact
    // fields in `update` so the id and createdAt stay stable across runs.
    const supplierIdByName = new Map<string, string>();
    let suppliersCreated = 0;
    let suppliersUpdated = 0;

    for (const s of suppliers) {
      const existing = await prisma.supplier.findFirst({ where: { name: s.name } });
      await prisma.supplier.upsert({
        where: { id: existing?.id ?? "__not_found__" },
        create: s,
        update: {
          contactName: s.contactName,
          email: s.email,
          phone: s.phone,
          address: s.address,
        },
      });
      const resolved = await prisma.supplier.findFirst({ where: { name: s.name } });
      if (!resolved) throw new Error(`Failed to resolve supplier "${s.name}" after upsert`);
      supplierIdByName.set(s.name, resolved.id);
      if (existing) {
        suppliersUpdated++;
      } else {
        suppliersCreated++;
      }
    }

    for (const p of products) {
      const before = await prisma.product.findUnique({ where: { sku: p.sku } });
      // Resolve the supplier link (if any) to a concrete id now, then strip
      // the helper field before handing the row to Prisma.
      const { supplier: _supplierName, ...productData } = p;
      const supplierId =
        _supplierName !== undefined ? supplierIdByName.get(_supplierName) : undefined;
      if (_supplierName !== undefined && supplierId === undefined) {
        throw new Error(
          `Product ${p.sku} references unknown supplier "${_supplierName}"`,
        );
      }

      await prisma.product.upsert({
        where: { sku: p.sku },
        create: { ...productData, supplierId: supplierId ?? null },
        update: {
          name: p.name,
          price: p.price,
          cost: p.cost,
          stock: p.stock,
          category: p.category,
          // Re-apply the link each run so editing the `supplier` mapping
          // rebinds products without leaving stale references.
          supplierId: supplierId ?? null,
        },
      });
      if (before) {
        updated++;
      } else {
        created++;
      }
    }

    const total = await prisma.product.count();
    const totalSuppliers = await prisma.supplier.count();
    console.log(
      `Seeding complete: ${suppliers.length} suppliers upserted by name ` +
        `(${suppliersCreated} created, ${suppliersUpdated} updated). ` +
        `Supplier table now holds ${totalSuppliers} row(s).`,
    );
    console.log(
      `Seeding complete: ${products.length} products upserted by SKU ` +
        `(${created} created, ${updated} updated). ` +
        `Product table now holds ${total} row(s).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exitCode = 1;
});
