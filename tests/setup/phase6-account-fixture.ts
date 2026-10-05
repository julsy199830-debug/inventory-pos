/**
 * Phase 6 E2E fixture: builds a KNOWN customer-account ledger directly.
 *
 * This runs as its OWN process (spawned by the spec), not as a module import.
 * Reason: `src/generated/prisma/client` uses `import.meta`, and Playwright loads
 * spec files as CommonJS — importing it at module scope throws
 * "Cannot use 'import.meta' outside a module" and, worse, aborts the ENTIRE
 * suite at collection time. Spawning keeps the app code untouched.
 *
 * Usage: `tsx tests/setup/phase6-account-fixture.ts seed <tag>` -> prints JSON
 *        `tsx tests/setup/phase6-account-fixture.ts clean <tag>`
 *
 * The ledger shape deliberately covers every movement direction:
 *   charge +500 -> payment -200 -> refund -100 -> write-off -50
 *   closing balance = 150
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

async function main() {
  const [mode, tag] = process.argv.slice(2);
  const url = process.env.DATABASE_URL ?? "file:./test-db/e2e.db";
  const p = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

  try {
    if (mode === "clean") {
      if (!tag) return;
      const rows = await p.customer.findMany({
        where: { email: { contains: tag } },
        select: { id: true },
      });
      for (const c of rows) {
        // Children cascade for payments/refunds/adjustments/events; sales do not,
        // so remove them explicitly to keep re-runs clean.
        await p.sale.deleteMany({ where: { customerId: c.id } });
        await p.customer.delete({ where: { id: c.id } });
      }
      console.log(JSON.stringify({ cleaned: rows.length }));
      return;
    }

    const admin = await p.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const a = await p.customer.create({
      data: {
        name: `Ledger Alpha ${tag}`,
        email: `alpha-${tag}@test.local`,
        creditLimit: 5000,
      },
      select: { id: true },
    });
    const b = await p.customer.create({
      data: {
        name: `Ledger Beta ${tag}`,
        email: `beta-${tag}@test.local`,
        creditLimit: 5000,
      },
      select: { id: true },
    });

    // Four distinct days so the date-range filter has something to narrow.
    const day = (n: number) => new Date(2026, 2, n, 10, 0, 0);

    const sale = await p.sale.create({
      data: {
        customerId: a.id,
        cashierId: admin.id,
        paymentMethod: "STORE_CREDIT",
        status: "Completed",
        subtotal: 500,
        tax: 0,
        discountAmount: 0,
        totalAmount: 500,
        createdAt: day(2),
        earnedPoints: 10,
      },
      select: { id: true },
    });

    await p.customerPayment.create({
      data: {
        customerId: a.id,
        cashierId: admin.id,
        amount: 200,
        paymentMethod: "CASH",
        kind: "PAYMENT",
        notes: "Partial settlement",
        createdAt: day(5),
      },
    });
    await p.saleRefund.create({
      data: {
        saleId: sale.id,
        cashierId: admin.id,
        amount: 100,
        reason: "Returned one item",
        createdAt: day(8),
      },
    });
    await p.accountAdjustment.create({
      data: {
        customerId: a.id,
        amount: -50,
        kind: "WRITE_OFF",
        reason: "Goodwill write-off",
        createdById: admin.id,
        createdAt: day(11),
      },
    });
    await p.loyaltyEvent.createMany({
      data: [
        {
          customerId: a.id,
          delta: 10,
          kind: "EARNED",
          reason: "Earned on sale",
          saleId: sale.id,
          createdAt: day(2),
        },
        {
          customerId: a.id,
          delta: -4,
          kind: "REDEEMED",
          reason: "Redeemed at checkout",
          saleId: sale.id,
          createdAt: day(9),
        },
      ],
    });

    console.log(JSON.stringify({ a: a.id, b: b.id }));
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});