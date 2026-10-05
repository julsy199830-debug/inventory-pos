import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { hashPin } from "../../src/lib/pin";

/**
 * Phase 7 fixture: a real MANAGER account.
 *
 * The seed only creates an ADMIN and a CASHIER, so a MANAGER session — which is
 * the entire point of the role-aware dashboard — could not be exercised at all.
 * This creates one (and an open shift for it) in the disposable `test-db`.
 *
 * Run as its OWN process because `src/generated/prisma/client` uses
 * `import.meta`, which throws inside Playwright's CommonJS module scope and
 * aborts collection for the whole suite.
 *
 *   tsx tests/setup/phase7-manager-fixture.ts seed <tag> <pin>
 *   tsx tests/setup/phase7-manager-fixture.ts clean <tag>
 */

async function main() {
  const [mode, tag, pin] = process.argv.slice(2);
  const p = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? "file:./test-db/e2e.db",
    }),
  });

  try {
    const email = `manager-${tag}@test.local`;
    if (mode === "clean") {
      const u = await p.user.findUnique({ where: { email }, select: { id: true } });
      if (u) {
        await p.shift.deleteMany({ where: { userId: u.id } });
        await p.user.delete({ where: { id: u.id } });
      }
      console.log(JSON.stringify({ cleaned: Boolean(u) }));
      return;
    }

    const user = await p.user.upsert({
      where: { email },
      update: { pinHash: await hashPin(pin ?? "2468"), role: "MANAGER", active: true },
      create: {
        name: "Moira Manager",
        email,
        role: "MANAGER",
        active: true,
        pinHash: await hashPin(pin ?? "2468"),
        // The column is non-null; PIN is the real credential. Mirrors how
        // `employees/actions.ts` populates it.
        passwordHash: "phase7-fixture-not-a-real-password",
      },
      select: { id: true },
    });

    // An open shift, so the dashboard's "On shift since" branch is exercised
    // rather than only the "Not clocked in" one.
    await p.shift.create({
      data: {
        userId: user.id,
        start: new Date(Date.now() - 2 * 60 * 60 * 1000),
        end: null,
      },
    });

    console.log(JSON.stringify({ id: user.id, email }));
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});