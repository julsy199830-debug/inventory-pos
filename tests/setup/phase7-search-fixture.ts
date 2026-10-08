import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/** Format: PO-YYYYMM-NNNNNN (see src/app/(dashboard)/purchasing/actions.ts,
 * the canonical PO-number contract). The tag is zero-padded into the
 * NNNNNN slot so the resulting number is accepted and displayed by the
 * purchase-order detail page. */
function poNumber(tag: string): string {
  const num = (parseInt(tag.slice(-6), 10) % 1000000).toString().padStart(6, "0");
  return `PO-202609-${num}`;
}

/**
 * Phase 7 Step 5 fixture: known rows the global-search spec can find.
 *
 * The shared seed catalog is stable ("Aurora Wireless Headphones", "ELEC-0001"),
 * which covers product search — but customers, sales, and purchase orders have no
 * guaranteed rows, so this creates one tagged set: a customer, a PO (with a
 * supplier), and a completed sale for that customer rung up by the seeded ADMIN.
 *
 * Run as its OWN process because `src/generated/prisma/client` uses
 * `import.meta`, which throws inside Playwright's CommonJS module scope.
 *
 *   tsx tests/setup/phase7-search-fixture.ts seed <tag>
 *   tsx tests/setup/phase7-search-fixture.ts clean <tag>
 */

async function main() {
  const [mode, tag] = process.argv.slice(2);
  if (!tag) throw new Error("tag is required");
  const p = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? "file:./test-db/e2e.db",
    }),
  });

  try {
    if (mode === "clean") {
      const customer = await p.customer.findFirst({
        where: { email: `search-${tag}@test.local` },
        select: { id: true },
      });
      if (customer) {
        await p.sale.deleteMany({ where: { customerId: customer.id } });
        await p.customer.delete({ where: { id: customer.id } });
      }
      const po = await p.purchaseOrder.findFirst({
        where: { notes: `search-fixture-${tag}` },
        select: { id: true },
      });
      if (po) {
        await p.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: po.id },
        });
        await p.purchaseOrder.delete({ where: { id: po.id } });
      }
      console.log(JSON.stringify({ cleaned: true }));
      return;
    }

    const admin = await p.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const product = await p.product.findFirstOrThrow({
      orderBy: { name: "asc" },
      select: { id: true },
    });
    const supplier = await p.supplier.findFirstOrThrow({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    const customer = await p.customer.create({
      data: {
        name: `Searchable Customer ${tag}`,
        email: `search-${tag}@test.local`,
        phone: `555-01-${tag.slice(-2)}`,
        creditLimit: 1000,
      },
      select: { id: true, name: true },
    });

    const sale = await p.sale.create({
      data: {
        customerId: customer.id,
        cashierId: admin.id,
        paymentMethod: "CASH",
        status: "Completed",
        subtotal: 100,
        tax: 0,
        discountAmount: 0,
        totalAmount: 100,
      },
      select: { id: true },
    });

    const po = await p.purchaseOrder.create({
      data: {
        poNumber: poNumber(tag),
        supplierId: supplier.id,
        createdById: admin.id,
        status: "ORDERED",
        notes: `search-fixture-${tag}`,
        items: {
          create: [{ productId: product.id, orderedQty: 5, unitCost: 10 }],
        },
      },
      select: { id: true, poNumber: true },
    });

    console.log(
      JSON.stringify({
        customerId: customer.id,
        customerName: customer.name,
        saleId: sale.id,
        saleNumber: sale.id.slice(0, 8).toUpperCase(),
        poId: po.id,
        poNumber: po.poNumber,
        supplierName: supplier.name,
      }),
    );
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});