/**
 * Direct Server Action authorization tests for employee management.
 *
 * Uses a disposable migrated SQLite database and the same Next.js request-surface
 * mocks as the purchasing action tests. No browser or real dev.db is involved.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import Module from "node:module";
import path from "node:path";

const MOCKS: Record<string, string> = {
  "server-only": path.resolve("tests/setup/mocks/server-only.cjs"),
  "next/headers": path.resolve("tests/setup/mocks/next-headers.cjs"),
  "next/cache": path.resolve("tests/setup/mocks/next-cache.cjs"),
};
const originalResolve = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
(Module as unknown as { _resolveFilename: Function })._resolveFilename = function (
  request: string,
  ...rest: unknown[]
) {
  return MOCKS[request] ?? originalResolve.call(this, request, ...rest);
};

declare global {
  var __PO_TEST_COOKIES__: Record<string, string> | undefined;
}

const DB_DIR = path.resolve("test-results", "employee-authorization-db");
const DB_REL_URL = "file:./test-results/employee-authorization-db/test.db";
const IDS = {
  admin: "employee-auth-admin",
  manager: "employee-auth-manager",
  cashier: "employee-auth-cashier",
  target: "employee-auth-target",
} as const;

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL - ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asUser(userId: string | null): void {
  globalThis.__PO_TEST_COOKIES__ = userId ? { "pos-cashier": userId } : {};
}
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}
function createForm(label: string) {
  return form({
    name: `Created ${label}`,
    email: `created-${label}@employee-auth.test`,
    pin: "2468",
    role: "CASHIER",
  });
}
function updateForm(id: string, label: string) {
  return form({
    id,
    name: `Updated ${label}`,
    email: `updated-${label}@employee-auth.test`,
    role: "CASHIER",
  });
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
  const actions = await import("@/app/(dashboard)/employees/actions");

  try {
    for (const [id, name, role] of [
      [IDS.admin, "Authorization Admin", "ADMIN"],
      [IDS.manager, "Authorization Manager", "MANAGER"],
      [IDS.cashier, "Authorization Cashier", "CASHIER"],
      [IDS.target, "Authorization Target", "CASHIER"],
    ] as const) {
      await prisma.user.create({
        data: { id, name, role, email: `${id}@employee-auth.test`, pinHash: "test-only", passwordHash: "test-only", active: true },
      });
    }

    const usersSnapshot = () => prisma.user.findMany({
      orderBy: { id: "asc" },
      select: { id: true, name: true, email: true, role: true, active: true, pinHash: true, passwordHash: true, createdAt: true, updatedAt: true },
    });

    async function deniedWithoutMutation(actor: string | null, invoke: () => unknown | Promise<unknown>) {
      const before = await usersSnapshot();
      const result = await invoke();
      if (result && typeof result === "object" && "ok" in result) {
        assert.equal((result as { ok: boolean }).ok, false);
      }
      assert.deepEqual(await usersSnapshot(), before, "authorization denial must precede every mutation");
    }
    const deniedCases: Array<[string, () => unknown | Promise<unknown>]> = [
      ["create", () => actions.createEmployee(createForm("cashier"))],
      ["update", () => actions.updateEmployee(updateForm(IDS.target, "cashier"))],
      ["toggle", () => actions.toggleEmployeeStatus(form({ id: IDS.target, active: "false" }))],
      ["assignRole", () => actions.assignRole(form({ id: IDS.target, role: "ADMIN" }))],
      ["delete", () => actions.deleteEmployee(form({ id: IDS.target }))],
    ];
    for (const actor of [IDS.cashier, null] as const) {
      const label = actor === null ? "signed-out" : "CASHIER";
      for (const [operation, invoke] of deniedCases) {
        await check(`${label} cannot ${operation} an employee`, async () => {
          asUser(actor);
          await deniedWithoutMutation(actor, invoke);
        });
      }
    }

    async function successfulManagementFlow(actor: string, label: string): Promise<void> {
      asUser(actor);
      const created = await actions.createEmployee(createForm(label));
      assert.equal(created.ok, true);
      const email = `created-${label}@employee-auth.test`;
      const employee = await prisma.user.findUniqueOrThrow({ where: { email } });

      const updated = await actions.updateEmployee(updateForm(employee.id, label));
      assert.equal(updated.ok, true);
      const toggle = await actions.toggleEmployeeStatus(form({ id: employee.id, active: "false" }));
      assert.equal(toggle.ok, true);
      const assign = await actions.assignRole(form({ id: employee.id, role: "MANAGER" }));
      assert.equal(assign.ok, true);

      await actions.deleteEmployee(form({ id: employee.id }));
      assert.equal(await prisma.user.findUnique({ where: { id: employee.id } }), null);
    }

    await check("ADMIN retains all intended employee-management capabilities", () => successfulManagementFlow(IDS.admin, "admin"));
    await check("MANAGER retains all intended employee-management capabilities", () => successfulManagementFlow(IDS.manager, "manager"));

    console.log(`Employee authorization tests: ${passed} passed, ${failed} failed.`);
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

