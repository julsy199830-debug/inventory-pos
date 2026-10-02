/**
 * Phase 5 — Lock Register / logout audit tests.
 *
 * The regression this covers: `signOutCashier` held the `LOGOUT` audit write but
 * nothing called it, so locking the register cleared the cookie and left NO
 * audit trail at all. The audit now lives in `lockRegister`, the one action both
 * "Lock Register" buttons actually invoke.
 *
 * What is pinned here:
 *   1. a real sign-out writes exactly one attributable LOGOUT row,
 *   2. the session cookie is actually gone afterwards,
 *   3. a second lock writes NOTHING (a double-click must not double-log), and
 *   4. locking with no session writes nothing — nothing happened.
 *
 * Uses the disposable migrated SQLite DB and the same Next.js request-surface
 * mocks as the DTR tests. No browser, no real dev.db.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { signSessionValue } from "@/lib/session-token";

const MOCKS: Record<string, string> = {
  "server-only": path.resolve("tests/setup/mocks/server-only.cjs"),
  "next/headers": path.resolve("tests/setup/mocks/next-headers.cjs"),
  "next/cache": path.resolve("tests/setup/mocks/next-cache.cjs"),
  // `lockRegister` ends in `redirect("/login")`, which THROWS in the real
  // framework. The stub reproduces that so these tests exercise the real
  // action instead of a rewritten copy of it.
  "next/navigation": path.resolve("tests/setup/mocks/next-navigation.cjs"),
};

type ResolveFilenameArgs = [
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown,
];
type ResolveFilename = (...args: ResolveFilenameArgs) => string;
const moduleResolver = Module as unknown as {
  _resolveFilename: ResolveFilename;
};
const originalResolve = moduleResolver._resolveFilename;
moduleResolver._resolveFilename = function (
  this: unknown,
  ...args: ResolveFilenameArgs
) {
  return MOCKS[args[0]] ?? originalResolve.apply(this, args);
};

declare global {
  var __PO_TEST_COOKIES__: Record<string, string> | undefined;
}

const DB_DIR = path.resolve("test-results", "logout-audit-db");
const DB_REL_URL = "file:./test-results/logout-audit-db/test.db";
const IDS = { admin: "logout-admin", cashier: "logout-cashier" } as const;

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(
      `FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function asUser(userId: string | null): void {
  globalThis.__PO_TEST_COOKIES__ =
    userId === null ? {} : { "pos-cashier": signSessionValue(userId) };
}

/** Call `lockRegister` and swallow the redirect throw it ends with. */
async function lock(lockRegister: () => Promise<void>): Promise<void> {
  try {
    await lockRegister();
  } catch (error) {
    // The redirect is expected; anything else is a real failure.
    if (error instanceof Error && /NEXT_REDIRECT/.test(error.message)) return;
    throw error;
  }
}
async function main(): Promise<void> {
  rmSync(DB_DIR, { recursive: true, force: true });
  mkdirSync(DB_DIR, { recursive: true });
  process.env.DATABASE_URL = DB_REL_URL;
  const migration = spawnSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true,
    env: { ...process.env, DATABASE_URL: DB_REL_URL },
  });
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  const { prisma } = await import("@/lib/db");
  const { lockRegister } = await import("@/lib/actions/auth-actions");

  try {
    for (const [id, name, role] of [
      [IDS.admin, "Logout Admin", "ADMIN"],
      [IDS.cashier, "Logout Cashier", "CASHIER"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name,
          role,
          email: `${id}@logout.test`,
          pinHash: "test-only",
          passwordHash: "test-only",
          active: true,
        },
      });
    }

    await check("locking the register writes one attributable LOGOUT row", async () => {
      asUser(IDS.admin);
      await lock(lockRegister);

      const rows = await prisma.auditLog.findMany({
        where: { action: "LOGOUT" },
      });
      assert.equal(rows.length, 1, "exactly one logout row");
      const row = rows[0];
      assert.equal(row.actor, "Logout Admin");
      assert.equal(row.userId, IDS.admin);
      assert.equal(row.entity, "User");
      assert.equal(row.entityId, IDS.admin);
      // Routed to the AUTH module by `ACTION_MODULES`, so it shows up under the
      // auth filter in /audit-log rather than as an uncategorized orphan.
      assert.equal(row.module, "AUTH");
    });

    await check("the session cookie is cleared by the lock", async () => {
      // The jar is the request surface `getCashier()` reads; after locking the
      // cookie must be gone, or the next render would still be "signed in".
      assert.equal(
        globalThis.__PO_TEST_COOKIES__?.["pos-cashier"],
        undefined,
        "pos-cashier cookie removed",
      );
    });

    await check("a second lock writes NO duplicate logout row", async () => {
      // A double-click, a stale tab, or a retry. The cookie is already gone, so
      // the action must record nothing — one real sign-out, one row.
      await lock(lockRegister);
      const rows = await prisma.auditLog.findMany({
        where: { action: "LOGOUT" },
      });
      assert.equal(rows.length, 1, "still exactly one logout row");
    });

    await check("locking with no session writes nothing", async () => {
      asUser(null);
      await lock(lockRegister);
      const rows = await prisma.auditLog.findMany({
        where: { action: "LOGOUT" },
      });
      assert.equal(rows.length, 1, "no row for a lock with nobody signed in");
    });

    await check("each employee gets their own attributed row", async () => {
      asUser(IDS.cashier);
      await lock(lockRegister);
      const rows = await prisma.auditLog.findMany({
        where: { action: "LOGOUT" },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(rows.length, 2);
      assert.equal(rows[0].actor, "Logout Admin");
      assert.equal(rows[1].actor, "Logout Cashier");
      assert.equal(rows[1].userId, IDS.cashier);
    });

    console.log(`Logout audit tests: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    rmSync(DB_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});